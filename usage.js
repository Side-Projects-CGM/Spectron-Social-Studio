(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = {'ad-text':'Advertentietekst','ai-background':'AI-achtergronden','ai-video':'AI-video','veo-test':'Veo-testpagina','veo-access-check':'Veo-toegangscontrole'};
  const displayLabels = {generate:'genereren',status:'statuscontrole',download:'downloaden',diagnostic:'toegangscontrole',submitted:'ingediend',completed:'voltooid',failed:'mislukt',pending:'in behandeling',unknown:'onbekend',succeeded:'geslaagd',production:'productie',local:'lokaal',preview:'testomgeving'};
  const display = value => displayLabels[value] || value;
  const n = value => new Intl.NumberFormat('nl-NL').format(value || 0);
  const time = value => new Intl.DateTimeFormat('nl-NL', {timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  let authorization = '', data = null, request = 0, controller;
  const text = (id, value) => { $(id).textContent = value; };
  function status(message, error = false) { text('status', message); $('status').classList.toggle('error', error); }
  function reported(g) { return g.attempts && g.totalUnknown === g.attempts && !g.totalTokens ? 'Onbekend' : n(g.totalTokens); }
  function table(id, rows, columns) {
    const target = $(id); target.replaceChildren();
    if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = columns; td.className = 'empty'; td.textContent = 'Er is nog geen activiteit vastgelegd.'; tr.append(td); target.append(tr); return; }
    for (const cells of rows) { const tr = document.createElement('tr'); for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } target.append(tr); }
  }
  function metricRow(label, t) { return [label,n(t.gemini.attempts),reported(t.gemini),n(t.veo.attempts),n(t.veo.completed),n(t.veo.estimatedCompletedSeconds)]; }
  function periods() { if (data) table('periodRows', Object.entries(data[$('period').value]).sort(([a],[b]) => b.localeCompare(a)).map(([key,t]) => metricRow(key,t)), 6); }
  function render(result) {
    data = result;
    const g = data.totals.gemini, v = data.totals.veo;
    text('trackingSince', data.trackingSince ? `Registratie sinds ${time(data.trackingSince)} \u00b7 ${display(data.environment)}` : `Geen activiteit vastgelegd \u00b7 ${display(data.environment)}`);
    text('updated', `Bijgewerkt op ${time(data.generatedAt)}`);
    text('totalTokens', reported(g)); text('inputOutput', `${g.attempts && g.inputUnknown === g.attempts ? 'Onbekend' : n(g.inputTokens)} / ${g.attempts && g.outputUnknown === g.attempts ? 'Onbekend' : n(g.outputTokens)}`);
    text('extraTokens', `${n(g.thinkingTokens)} denktokens \u00b7 ${n(g.cachedTokens)} gecachet (al inbegrepen in de totalen van de aanbieder)`);
    text('geminiAttempts', n(g.attempts)); text('geminiOutcomes', `${n(g.succeeded)} geslaagde antwoorden \u00b7 ${n(g.failed)} mislukt \u00b7 ${n(g.unknown)} onbekend`);
    text('veoAttempts', n(v.attempts)); text('veoSubmitted', `${n(v.submitted)} geaccepteerde aanvragen`);
    text('veoCompleted', n(v.completed)); text('veoOutcomes', `${n(v.failed)} mislukt \u00b7 ${n(v.pending)} in behandeling \u00b7 ${n(v.unknown)} onbekend`);
    text('veoSeconds', n(v.estimatedCompletedSeconds)); text('veoDuration', `${n(v.videos)} ontvangen video’s \u00b7 ${n(v.requestedSeconds)} seconden aangevraagd`);
    text('veoCalls', `${n(v.statusCalls)} statuscontroles \u00b7 ${n(v.downloadCalls)} downloads \u00b7 ${n(v.diagnosticCalls)} toegangscontroles`);
    $('quality').hidden = !g.missingMetadata && !data.incompleteRecords;
    text('quality', `${n(g.missingMetadata)} Gemini-aanvragen hebben onvolledige tokengegevens; de getoonde totalen bevatten alleen gerapporteerde waarden. ${n(data.incompleteRecords)} API-aanroepen hebben geen vastgelegd resultaat. Onbekend gebruik is niet hetzelfde als nul.`);
    periods(); table('featureRows', Object.entries(data.features).map(([key,t]) => metricRow(labels[key] || key,t)), 6);
    table('recentRows', data.recent.map(r => [time(r.timestamp),labels[r.feature] || r.feature,display(r.requestType),display(r.state || r.operationState || r.outcome),r.provider === 'gemini' ? (r.tokens?.totalTokenCount == null ? 'Onbekend' : n(r.tokens.totalTokenCount)) : 'Niet gerapporteerd']), 5);
    $('dashboard').hidden = false; $('login').hidden = true; $('refresh').hidden = false; $('logout').hidden = false;
  }
  function lock() {
    request++; controller?.abort(); authorization = ''; data = null; $('password').value = '';
    $('dashboard').hidden = true; $('login').hidden = false; $('refresh').hidden = true; $('logout').hidden = true;
    for (const id of ['periodRows','featureRows','recentRows']) $(id).replaceChildren();
    status('Dashboard vergrendeld.'); $('password').focus();
  }
  async function load() {
    const current = ++request; controller?.abort(); controller = new AbortController();
    $('refresh').disabled = true; $('unlock').disabled = true; status('Gebruiksgegevens worden geladen...');
    try {
      const response = await fetch('/.netlify/functions/usage', {headers:{Authorization:authorization}, cache:'no-store', signal:controller.signal});
      const result = await response.json(); if (current !== request) return;
      if (!response.ok) { if (response.status === 401) lock(); throw new Error(result.error || 'De gebruiksgegevens konden niet worden geladen.'); }
      render(result); $('password').value = ''; status('');
    } catch (error) { if (error.name !== 'AbortError' && (current === request || !authorization)) status(error.message, true); }
    finally { if (current === request || !authorization) { $('refresh').disabled = false; $('unlock').disabled = false; } }
  }
  $('loginForm').addEventListener('submit', event => { event.preventDefault(); const bytes = new TextEncoder().encode(`usage:${$('password').value}`); authorization = `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`; load(); });
  $('refresh').addEventListener('click', load); $('logout').addEventListener('click', lock); $('period').addEventListener('change', periods);
})();
