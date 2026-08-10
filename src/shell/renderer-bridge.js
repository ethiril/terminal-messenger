function runRendererAction(targetContents, methodName) {
  if (!targetContents || targetContents.isDestroyed()) return;
  targetContents
    .executeJavaScript(`window.TerminalMessenger?.${methodName}?.()`)
    .catch((error) => console.error(`renderer action '${methodName}' failed:`, error));
}

module.exports = { runRendererAction };
