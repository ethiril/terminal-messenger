function runRendererAction(targetWindow, methodName) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  targetWindow.webContents
    .executeJavaScript(`window.TerminalMessenger?.${methodName}?.()`)
    .catch((error) => console.error(`renderer action '${methodName}' failed:`, error));
}

module.exports = { runRendererAction };
