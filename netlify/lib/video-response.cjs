/** @typedef {{type:string, mime_type?:string, data?:string, uri?:string}} VideoContent */
/** @typedef {{status?:string, error?:unknown, steps?:Array<{type:string, content?:VideoContent[]}>}} Interaction */

const INTERACTION_PATTERN = /^interactions\/[A-Za-z0-9_-]{1,2048}$/;
const INTERACTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/;

/** @param {Interaction | null} result @returns {VideoContent | undefined} */
function interactionVideo(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  return steps.filter(step => step?.type === 'model_output')
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .find(content => content?.type === 'video'
      && (content.mime_type === undefined || content.mime_type === 'video/mp4')
      && (content.data || content.uri));
}

/** @param {Interaction | null} result @returns {'pending'|'failed'|'completed'|'unknown'} */
function interactionState(result) {
  if (result?.status === 'in_progress') return 'pending';
  if (['failed', 'cancelled'].includes(result?.status)) return 'failed';
  if (result?.status === 'completed') return 'completed';
  return 'unknown';
}

module.exports = {INTERACTION_PATTERN, INTERACTION_ID_PATTERN, interactionVideo, interactionState};
