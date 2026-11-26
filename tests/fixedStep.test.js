// Fixed-step accumulator tests: frame-rate independence and catch-up guard.
import { test, assert, assertEqual, assertClose } from './harness.js';
import { SIM_DT, MAX_SIM_STEPS } from '../src/config/constants.js';
import { advanceFixedStep } from '../src/core/fixedStep.js';

const STEPS_PER_SECOND = Math.round(1 / SIM_DT);

function runFrames(frameDt, frameCount, maxSteps = MAX_SIM_STEPS) {
  let accumulator = 0;
  let totalSteps = 0;
  let drops = 0;
  for (let i = 0; i < frameCount; i++) {
    const result = advanceFixedStep(accumulator, frameDt, SIM_DT, maxSteps, () => {
      totalSteps++;
    });
    accumulator = result.accumulator;
    if (result.dropped) drops++;
  }
  return { totalSteps, accumulator, drops };
}

test('fixed step: 30/60/144 Hz each advance roughly one second of simulation', () => {
  const at30 = runFrames(1 / 30, 30);
  const at60 = runFrames(1 / 60, 60);
  const at144 = runFrames(1 / 144, 144);

  assertEqual(at30.totalSteps, STEPS_PER_SECOND);
  assertEqual(at60.totalSteps, STEPS_PER_SECOND);
  assert(
    at144.totalSteps >= STEPS_PER_SECOND - 2 && at144.totalSteps <= STEPS_PER_SECOND + 2,
    `144Hz steps=${at144.totalSteps}`
  );
  assertEqual(at30.drops, 0);
  assertEqual(at60.drops, 0);
  assertEqual(at144.drops, 0);
});

test('fixed step: a low frame still catches up with multiple steps', () => {
  const at20 = runFrames(1 / 20, 20);
  assertEqual(at20.totalSteps, STEPS_PER_SECOND);
  assertEqual(at20.drops, 0);
});

test('fixed step: a long stall is capped and the backlog is dropped', () => {
  let steps = 0;
  const result = advanceFixedStep(0, 1.0, SIM_DT, MAX_SIM_STEPS, () => {
    steps++;
  });
  assertEqual(steps, MAX_SIM_STEPS);
  assertEqual(result.steps, MAX_SIM_STEPS);
  assertEqual(result.dropped, true);
  assertEqual(result.accumulator, 0);
});

test('fixed step: partial time stays in the accumulator', () => {
  let steps = 0;
  const result = advanceFixedStep(0, SIM_DT * 0.5, SIM_DT, 5, () => {
    steps++;
  });
  assertEqual(steps, 0);
  assertClose(result.accumulator, SIM_DT * 0.5);
});
