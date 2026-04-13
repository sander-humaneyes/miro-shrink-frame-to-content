(function () {
  const state = {
    busy: false,
    frames: [],
    lastRun: null,
    selection: [],
  };

  const elements = {};

  function hasMiroContext() {
    return Boolean(window.miro && miro.board && miro.board.ui && miro.board.notifications);
  }

  function cacheElements() {
    elements.closeButton = document.getElementById('close-button');
    elements.fitButton = document.getElementById('fit-button');
    elements.frameCount = document.getElementById('frame-count');
    elements.paddingInput = document.getElementById('padding-input');
    elements.refreshButton = document.getElementById('refresh-button');
    elements.resultList = document.getElementById('result-list');
    elements.resultSummary = document.getElementById('result-summary');
    elements.selectionCount = document.getElementById('selection-count');
    elements.selectionNote = document.getElementById('selection-note');
    elements.selectionStatus = document.getElementById('selection-status');
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    elements.fitButton.disabled = isBusy || state.frames.length === 0;
    elements.refreshButton.disabled = isBusy;
    elements.closeButton.disabled = isBusy;
    elements.paddingInput.disabled = isBusy;
    elements.fitButton.textContent = isBusy ? 'Shrinking frames...' : 'Shrink selected frames';
  }

  function setUnavailableState() {
    elements.selectionCount.textContent = '0';
    elements.frameCount.textContent = '0';
    elements.selectionStatus.textContent = 'Open this panel inside Miro';
    elements.selectionStatus.dataset.variant = 'warning';
    elements.selectionNote.textContent = 'The panel UI loads correctly here, but board actions only work when the page is opened by the Miro Web SDK.';
    elements.fitButton.disabled = true;
    elements.refreshButton.disabled = true;
    elements.closeButton.disabled = true;
    elements.paddingInput.disabled = true;
    elements.resultSummary.textContent = 'Preview only';
    elements.resultList.innerHTML = '';

    const emptyState = document.createElement('li');
    emptyState.className = 'result-item result-item--empty';
    emptyState.textContent = 'Install the app in Miro to resize frames.';
    elements.resultList.appendChild(emptyState);
  }

  function renderSelection() {
    const selectionCount = state.selection.length;
    const frameCount = state.frames.length;

    elements.selectionCount.textContent = String(selectionCount);
    elements.frameCount.textContent = String(frameCount);

    if (!selectionCount) {
      elements.selectionStatus.textContent = 'Nothing selected';
      elements.selectionStatus.dataset.variant = 'idle';
      elements.selectionNote.textContent = 'Select one or more frames on the board to enable resizing.';
      return;
    }

    if (!frameCount) {
      elements.selectionStatus.textContent = 'No frames in selection';
      elements.selectionStatus.dataset.variant = 'warning';
      elements.selectionNote.textContent = 'Your current selection does not include any frame items.';
      return;
    }

    elements.selectionStatus.textContent = frameCount === 1 ? '1 frame ready' : `${frameCount} frames ready`;
    elements.selectionStatus.dataset.variant = 'ready';
    elements.selectionNote.textContent =
      frameCount === selectionCount
        ? 'Every selected item is a frame, so the whole selection can be resized.'
        : `${frameCount} frame${frameCount === 1 ? '' : 's'} will be resized. Non-frame items are ignored.`;
  }

  function formatSummary(summary) {
    if (!summary) {
      return 'Nothing run yet';
    }

    if (!summary.frameCount) {
      return 'No selected frames';
    }

    const parts = [];

    if (summary.successCount) {
      parts.push(`${summary.successCount} fitted`);
    }

    if (summary.noopCount) {
      parts.push(`${summary.noopCount} unchanged`);
    }

    if (summary.skippedCount) {
      parts.push(`${summary.skippedCount} skipped`);
    }

    if (summary.errorCount) {
      parts.push(`${summary.errorCount} failed`);
    }

    return parts.join(' | ');
  }

  function resultStatusLabel(status) {
    if (status === 'success') {
      return 'Fitted';
    }

    if (status === 'noop') {
      return 'Unchanged';
    }

    if (status === 'skipped') {
      return 'Skipped';
    }

    return 'Failed';
  }

  function renderResults() {
    elements.resultSummary.textContent = formatSummary(state.lastRun && state.lastRun.summary);
    elements.resultList.innerHTML = '';

    if (!state.lastRun || !state.lastRun.results.length) {
      const emptyState = document.createElement('li');
      emptyState.className = 'result-item result-item--empty';
      emptyState.textContent = 'Run the action to see per-frame results here.';
      elements.resultList.appendChild(emptyState);
      return;
    }

    for (const result of state.lastRun.results) {
      const item = document.createElement('li');
      item.className = 'result-item';

      const status = document.createElement('span');
      status.className = 'result-chip';
      status.dataset.variant = result.status;
      status.textContent = resultStatusLabel(result.status);

      const title = document.createElement('strong');
      title.className = 'result-title';
      title.textContent = result.frameLabel;

      const body = document.createElement('p');
      body.className = 'result-body';
      body.textContent = result.message;

      item.appendChild(status);
      item.appendChild(title);
      item.appendChild(body);
      elements.resultList.appendChild(item);
    }
  }

  async function refreshSelection(selectionOverride) {
    const selection = selectionOverride !== undefined ? selectionOverride : await miro.board.getSelection();
    state.selection = selection;
    state.frames = selection.filter(window.AutoFrames.isFrame);
    renderSelection();
    setBusy(state.busy);
  }

  async function notifyForResult(run) {
    const { errorCount, frameCount, skippedCount, successCount } = run.summary;

    if (!frameCount) {
      await miro.board.notifications.showInfo('Select at least one frame before running Auto Frames.');
      return;
    }

    if (errorCount) {
      await miro.board.notifications.showError(`Auto Frames fitted ${successCount} frame(s) and failed on ${errorCount}.`);
      return;
    }

    if (successCount) {
      const suffix = skippedCount ? `, skipped ${skippedCount}` : '';
      await miro.board.notifications.showInfo(`Auto Frames fitted ${successCount} frame(s)${suffix}.`);
      return;
    }

    if (skippedCount) {
      await miro.board.notifications.showInfo(`Auto Frames skipped ${skippedCount} frame(s).`);
      return;
    }

    await miro.board.notifications.showInfo('No selected frames needed resizing.');
  }

  async function handleFit() {
    const padding = window.AutoFrames.sanitizePadding(elements.paddingInput.value);
    elements.paddingInput.value = String(padding);

    setBusy(true);

    try {
      const run = await window.AutoFrames.fitSelectedFrames({ padding });
      state.lastRun = run;
      renderResults();
      await refreshSelection();
      await notifyForResult(run);
    } catch (error) {
      console.error('Auto Frames failed to process the current selection', error);
      await miro.board.notifications.showError('Auto Frames could not resize the selected frames.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    await miro.board.ui.closePanel();
  }

  async function init() {
    cacheElements();
    renderResults();

    if (!hasMiroContext()) {
      setUnavailableState();
      return;
    }

    elements.fitButton.addEventListener('click', handleFit);
    elements.refreshButton.addEventListener('click', () => {
      refreshSelection().catch((error) => {
        console.error('Auto Frames failed to refresh selection', error);
      });
    });
    elements.closeButton.addEventListener('click', handleClose);

    const selectionUpdate = (event) => {
      refreshSelection(event.items).catch((error) => {
        console.error('Auto Frames failed to refresh selection', error);
      });
    };

    miro.board.ui.on('selection:update', selectionUpdate);
    window.addEventListener('pagehide', () => {
      miro.board.ui.off('selection:update', selectionUpdate);
    });

    await refreshSelection();
    setBusy(false);
  }

  init().catch(async (error) => {
    console.error('Auto Frames panel failed to initialize', error);
    try {
      await miro.board.notifications.showError('Auto Frames failed to initialize.');
    } catch (notificationError) {
      console.error('Auto Frames could not show its initialization error', notificationError);
    }
  });
})();
