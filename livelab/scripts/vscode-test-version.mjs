/**
 * One immutable VS Code runtime for every LiveLab extension-host proof.
 *
 * Keeping downloads version-pinned prevents a new upstream stable release from
 * changing executable layout or extension-host behavior between PR reruns.
 */
export const VSCODE_TEST_VERSION = '1.131.0';
