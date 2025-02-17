/*
 * Tencent is pleased to support the open source community by making
 * Hippy available.
 *
 * Copyright (C) 2017-2019 THL A29 Limited, a Tencent company.
 * All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { HippyEventEmitter, HippyEventRevoker } from '../event';
import { Bridge, Device } from '../native';
import { warn } from '../utils';
import { repeatCountDict } from '../utils/animation';
import { colorParse } from '../color';
import { Platform } from '../types';

type AnimationValue = number | { animationId: number} | string;
type AnimationCallback = () => void;
type AnimationDirection = 'left' | 'right' | 'top' | 'bottom' | 'center';

interface AnimationOptions {
  /**
   * Initial value at `Animation` start
   */
  startValue: AnimationValue;

  /**
   * End value when `Animation` end.
   */
  toValue: AnimationValue;

  /**
   * Animation execution time
   */
  duration: number;

  /**
   * Timeline mode of animation
   */
  mode?: 'timing'; // TODO: fill more options

  /**
   * Delay starting time
   */
  delay?: number;

  /**
   * Value type, leave it blank in most case, except use rotate/color related
   * animation, set it to be 'deg' or 'color'.
   */
  valueType?: 'deg'; // TODO: fill more options

  /**
   * Animation start position
   */
  direction?: AnimationDirection;

  /**
   * Animation interpolation type
   */
  timingFunction?: 'linear' | 'ease' | 'bezier' | 'in' | 'ease-in' | 'out' | 'ease-out' | 'inOut' | 'ease-in-out' | (string & {});

  /**
   * Animation repeat times, use 'loop' to be always repeating.
   */
  repeatCount?: number;

  inputRange?: any[];
  outputRange?: any[];
}

interface Animation extends AnimationOptions {
  animationId: number;
  onAnimationStartCallback?: AnimationCallback;
  onAnimationEndCallback?: AnimationCallback;
  onAnimationCancelCallback?: AnimationCallback;
  onAnimationRepeatCallback?: AnimationCallback;
  animationStartListener?: HippyEventRevoker;
  animationEndListener?: HippyEventRevoker;
  animationCancelListener?: HippyEventRevoker;
  animationRepeatListener?: HippyEventRevoker;

  // Fallback event handlers
  onRNfqbAnimationStart?: Function;
  onRNfqbAnimationEnd?: Function;
  onRNfqbAnimationCancel?: Function;
  onRNfqbAnimationRepeat?: Function;
  onHippyAnimationStart?: Function;
  onHippyAnimationEnd?: Function;
  onHippyAnimationCancel?: Function;
  onHippyAnimationRepeat?: Function;
}

const AnimationEventEmitter = new HippyEventEmitter();

/**
 * parse value of special value type
 * @param valueType
 * @param originalValue
 */
function parseValue(valueType: string | undefined, originalValue: number | string) {
  if (valueType === 'color' && ['number', 'string'].indexOf(typeof originalValue) >= 0) {
    return colorParse(originalValue);
  }
  return originalValue;
}


/**
 * Better performance of Animation solution.
 *
 * It pushes the animation scheme to native at once.
 */
class Animation implements Animation {
  public constructor(config: AnimationOptions) {
    let startValue: AnimationValue = 0;
    if (config.startValue?.constructor && config.startValue.constructor.name === 'Animation') {
      startValue = { animationId: (config.startValue as Animation).animationId };
    } else {
      const { startValue: tempStartValue } = config;
      startValue = parseValue(config.valueType, tempStartValue as number|string);
    }
    const toValue = parseValue(config.valueType, config.toValue as number|string);
    this.mode = config.mode || 'timing';
    this.delay = config.delay || 0;
    this.startValue = startValue || 0;
    this.toValue = toValue || 0;
    this.valueType = config.valueType || undefined;
    this.duration = config.duration || 0;
    this.direction = config.direction || 'center';
    this.timingFunction = config.timingFunction || 'linear';
    this.repeatCount = repeatCountDict(config.repeatCount || 0);
    this.inputRange = config.inputRange || [];
    this.outputRange = config.outputRange || [];

    this.animationId = Bridge.callNativeWithCallbackId('AnimationModule', 'createAnimation', true, this.mode, Object.assign({
      delay: this.delay,
      startValue: this.startValue,
      toValue: this.toValue,
      duration: this.duration,
      direction: this.direction,
      timingFunction: this.timingFunction,
      repeatCount: this.repeatCount,
      inputRange: this.inputRange,
      outputRange: this.outputRange,
    }, (this.valueType ? { valueType: this.valueType } : {})));

    this.destroy = this.destroy.bind(this);

    // TODO: Deprecated compatible, will remove soon.
    this.onRNfqbAnimationStart = this.onAnimationStart.bind(this);
    this.onRNfqbAnimationEnd = this.onAnimationEnd.bind(this);
    this.onRNfqbAnimationCancel = this.onAnimationCancel.bind(this);
    this.onRNfqbAnimationRepeat = this.onAnimationRepeat.bind(this);
    this.onHippyAnimationStart = this.onAnimationStart.bind(this);
    this.onHippyAnimationEnd = this.onAnimationEnd.bind(this);
    this.onHippyAnimationCancel = this.onAnimationCancel.bind(this);
    this.onHippyAnimationRepeat = this.onAnimationRepeat.bind(this);
  }

  /**
   * Remove all of animation event listener
   */
  public removeEventListener() {
    if (this.animationStartListener) {
      this.animationStartListener.remove();
    }
    if (this.animationEndListener) {
      this.animationEndListener.remove();
    }
    if (this.animationCancelListener) {
      this.animationCancelListener.remove();
    }
    if (this.animationRepeatListener) {
      this.animationRepeatListener.remove();
    }
  }

  /**
   * Start animation execution
   */
  public start() {
    this.removeEventListener();

    // Set as iOS default
    let animationEventName = 'onAnimation';
    // If running in Android, change it.
    if (__PLATFORM__ === Platform.android || Device.platform.OS === Platform.android) {
      animationEventName = 'onHippyAnimation';
    }

    if (typeof this.onAnimationStartCallback === 'function') {
      this.animationStartListener = AnimationEventEmitter.addListener(`${animationEventName}Start`, (animationId) => {
        if (animationId === this.animationId) {
          (this.animationStartListener as HippyEventRevoker).remove();
          if (typeof this.onAnimationStartCallback === 'function') {
            this.onAnimationStartCallback();
          }
        }
      });
    }
    if (typeof this.onAnimationEndCallback === 'function') {
      this.animationEndListener = AnimationEventEmitter.addListener(`${animationEventName}End`, (animationId) => {
        if (animationId === this.animationId) {
          (this.animationEndListener as HippyEventRevoker).remove();
          if (typeof this.onAnimationEndCallback === 'function') {
            this.onAnimationEndCallback();
          }
        }
      });
    }
    if (typeof this.onAnimationCancelCallback === 'function') {
      this.animationCancelListener = AnimationEventEmitter.addListener(`${animationEventName}Cancel`, (animationId) => {
        if (animationId === this.animationId) {
          (this.animationCancelListener as HippyEventRevoker).remove();
          if (typeof this.onAnimationCancelCallback === 'function') {
            this.onAnimationCancelCallback();
          }
        }
      });
    }
    if (typeof this.onAnimationRepeatCallback === 'function') {
      this.animationRepeatListener = AnimationEventEmitter.addListener(`${animationEventName}Repeat`, (animationId) => {
        if (animationId === this.animationId) {
          if (typeof this.onAnimationRepeatCallback === 'function') {
            this.onAnimationRepeatCallback();
          }
        }
      });
    }
    Bridge.callNative('AnimationModule', 'startAnimation', this.animationId);
  }

  /**
   * Use destroy() to destroy animation.
   */
  public destory() {
    warn('Animation.destory() method will be deprecated soon, please use Animation.destroy() as soon as possible');
    this.destroy();
  }

  /**
   * Destroy the animation
   */
  public destroy() {
    this.removeEventListener();
    Bridge.callNative('AnimationModule', 'destroyAnimation', this.animationId);
  }

  /**
   * Pause the running animation
   */
  public pause() {
    Bridge.callNative('AnimationModule', 'pauseAnimation', this.animationId);
  }

  /**
   * Resume execution of paused animation
   */
  public resume() {
    Bridge.callNative('AnimationModule', 'resumeAnimation', this.animationId);
  }

  /**
   * Update to new animation scheme
   *
   * @param {Object} newConfig - new animation schema
   */
  public updateAnimation(newConfig: AnimationOptions) {
    if (typeof newConfig !== 'object') {
      throw new TypeError('Invalid arguments');
    }

    if (typeof newConfig.mode === 'string' && newConfig.mode !== this.mode) {
      throw new TypeError('Update animation mode not supported');
    }

    (Object.keys(newConfig) as (keyof AnimationOptions)[]).forEach((prop) => {
      const value = newConfig[prop];
      if (prop === 'startValue') {
        let startValue: AnimationValue = 0;
        if (newConfig.startValue instanceof Animation) {
          startValue = { animationId: newConfig.startValue.animationId };
        } else {
          const { startValue: tempStartValue } = newConfig;
          startValue = parseValue(this.valueType, tempStartValue as number|string);
        }
        this.startValue = startValue || 0;
      } else if (prop === 'repeatCount') {
        this.repeatCount = repeatCountDict(newConfig.repeatCount || 0);
      } else {
        Object.defineProperty(this, prop, {
          value,
        });
      }
    });

    Bridge.callNative('AnimationModule', 'updateAnimation', this.animationId, Object.assign({
      delay: this.delay,
      startValue: this.startValue,
      toValue: parseValue(this.valueType, this.toValue as number|string),
      duration: this.duration,
      direction: this.direction,
      timingFunction: this.timingFunction,
      repeatCount: this.repeatCount,
      inputRange: this.inputRange,
      outputRange: this.outputRange,
    }, (this.valueType ? { valueType: this.valueType } : {})));
  }

  /**
   * Call when animation started.
   * @param {Function} cb - callback when animation started.
   */
  public onAnimationStart(cb: AnimationCallback) {
    this.onAnimationStartCallback = cb;
  }

  /**
   * Call when animation is ended.
   * @param {Function} cb - callback when animation started.
   */
  public onAnimationEnd(cb: AnimationCallback) {
    this.onAnimationEndCallback = cb;
  }

  /**
   * Call when animation is canceled.
   * @param {Function} cb - callback when animation started.
   */
  public onAnimationCancel(cb: AnimationCallback) {
    this.onAnimationCancelCallback = cb;
  }

  /**
   * Call when animation is repeated.
   * @param {Function} cb - callback when animation started.
   */
  public onAnimationRepeat(cb: AnimationCallback) {
    this.onAnimationRepeatCallback = cb;
  }
}

export default Animation;
export {
  Animation,
  AnimationCallback,
};
