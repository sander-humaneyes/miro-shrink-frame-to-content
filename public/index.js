(function () {
  const APP_NAME = 'Shrink frame to content';
  const PANEL_URL = new URL('./panel.html', window.location.href).toString();

  function hasMiroContext() {
    return Boolean(window.miro && miro.board && miro.board.ui && miro.board.notifications);
  }

  async function showError(message) {
    try {
      await miro.board.notifications.showError(message);
    } catch (notificationError) {
      console.error(`${APP_NAME} notification failed`, notificationError);
    }
  }

  async function openPanel() {
    const canOpenPanel = await miro.board.ui.canOpenPanel();

    if (!canOpenPanel) {
      await miro.board.notifications.showInfo('Close the current panel before opening this app.');
      return;
    }

    await miro.board.ui.openPanel({
      url: PANEL_URL,
    });
  }

  async function init() {
    if (!hasMiroContext()) {
      return;
    }

    miro.board.ui.on('icon:click', async () => {
      try {
        await openPanel();
      } catch (error) {
        console.error(`${APP_NAME} failed to open its panel`, error);
        await showError('Could not open the panel.');
      }
    });
  }

  init().catch(async (error) => {
    console.error(`${APP_NAME} failed to initialize`, error);
    await showError('The app failed to initialize.');
  });
})();
