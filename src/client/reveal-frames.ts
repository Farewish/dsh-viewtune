/**
 * The keyframes one revealed word animates through.
 *
 * The reference recipe fades a word in AND takes a 1px blur off it. The blur is the expensive half and the subtle
 * one: `filter` is not a property the compositor can animate on its own, so every animating word makes the browser
 * repaint its own area on every frame — and because a word's reveal lasts 350ms while roughly fifty arrive per
 * second, about a dozen of those repaints overlap at any moment for as long as a message streams. Dropping it leaves
 * opacity, which the compositor animates without repainting anything.
 *
 * Pure, in a module of its own, because that trade is a decision worth testing rather than a literal inside a
 * component: with the blur off there must be no `filter` left in the keyframes at all, which is the whole point.
 */
import { WORD_MOTION } from './word-timeline.js';

/**
 * The start and end pose of a revealed word.
 *
 * Typed as the DOM's own `Keyframe` rather than as a shape of this module's own: `Element.animate` is what consumes
 * these, and a narrower interface — even one with exactly these two properties — is not assignable to it.
 *
 * @param blur - Whether the reveal also resolves from `WORD_MOTION.blur`. `false` returns frames that name no filter
 * at all, rather than a filter that happens to be a no-op: `blur(0px)` still puts the property in the animation, and
 * a `filter` on either keyframe is what keeps the word off the compositor's own path.
 */
export function revealFrames(blur: boolean): Keyframe[] {
  if (!blur) return [{ opacity: 0 }, { opacity: 1 }];
  return [{ opacity: 0, filter: `blur(${String(WORD_MOTION.blur)}px)` }, { opacity: 1, filter: 'blur(0px)' }];
}
