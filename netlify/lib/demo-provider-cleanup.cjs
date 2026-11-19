// Google API reference: https://aistudio.google.com/api-reference/interactions-api
// Deleting API resources does not erase Google's safety/legal retention or downloaded copies.
const API = 'https://generativelanguage.googleapis.com/v1beta/';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'incomplete', 'requires_action', 'requires_continuation']);

function fileResource(uri) {
  if (typeof uri !== 'string') throw new Error('Invalid provider file reference');
  const relative = /^(files\/[A-Za-z0-9_-]+)(?::download)?$/.exec(uri);
  if (relative) return relative[1];
  const url = new URL(uri);
  if (url.origin !== 'https://generativelanguage.googleapis.com' || url.username || url.password) throw new Error('Unsupported provider file reference');
  const match = /^\/v1beta\/(files\/[A-Za-z0-9_-]+)(?::download)?$/.exec(url.pathname);
  if (!match) throw new Error('Unsupported provider file reference');
  return match[1];
}
function outputFiles(interaction) {
  const files = new Set();
  for (const step of interaction.steps || []) {
    if (step.type !== 'model_output') continue;
    for (const part of step.content || []) {
      if (['video', 'image', 'audio'].includes(part.type) && part.uri) files.add(fileResource(part.uri));
    }
  }
  return [...files];
}
function createProviderCleanup({apiKey, fetcher = fetch, timeout = 15000} = {}) {
  async function request(path, method = 'GET') {
    if (!apiKey) throw new Error('Provider cleanup not configured');
    const response = await fetcher(API + path, {method, redirect:'error',
      headers:{'x-goog-api-key':apiKey, 'Api-Revision':'2026-05-20'}, signal:AbortSignal.timeout(timeout)});
    if (!response.ok && response.status !== 404) throw new Error('Provider cleanup was not confirmed');
    return response;
  }
  return async function removeInteraction(operation) {
    if (!/^interactions\/[A-Za-z0-9_-]+$/.test(operation)) throw new Error('Invalid interaction reference');
    const first = await request(operation);
    if (first.status === 404) return;
    let interaction = await first.json();
    // Collect file references before cancellation, which may return an abbreviated interaction.
    const files = new Set(outputFiles(interaction));
    if (interaction.status === 'in_progress') {
      const cancelled = await request(`${operation}/cancel`, 'POST');
      if (cancelled.status === 404) throw new Error('Interaction disappeared before cleanup was confirmed');
      interaction = await cancelled.json();
      for (const file of outputFiles(interaction)) files.add(file);
    }
    if (!TERMINAL.has(interaction.status)) throw new Error('Interaction has not stopped');
    // Files first: a failed file deletion must not destroy the interaction's cleanup references.
    for (const file of files) await request(file, 'DELETE');
    await request(operation, 'DELETE');
  };
}
module.exports = {createProviderCleanup, fileResource, outputFiles};
