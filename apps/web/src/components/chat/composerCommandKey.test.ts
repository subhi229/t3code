import { describe, expect, it, vi } from "vite-plus/test";

import { composerCommandKeyHandler } from "./composerCommandKey";

type HandlerInput = Parameters<typeof composerCommandKeyHandler>[0];

function key(name: string, modifiers: Partial<KeyboardEvent> = {}) {
  return {
    key: name,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    keyCode: 0,
    preventDefault: () => {},
    ...modifiers,
  } as KeyboardEvent;
}

function setup(overrides: Partial<HandlerInput> = {}) {
  const spies = {
    setComposerDraftPrompt: vi.fn(),
    submitComposer: vi.fn(),
    toggleInteractionMode: vi.fn(),
    dismissComposerTrigger: vi.fn(),
    dismissPrediction: vi.fn(),
  };
  const input = {
    keybindings: [],
    sendShortcut: "enter",
    routeKind: "server",
    phase: "ready",
    isCompacting: false,
    followUpBehavior: "steer",
    isSoftwareKeyboardOpen: false,
    planModeUiEnabled: true,
    isLiteralPendingAnswer: false,
    pendingUserInputs: [],
    promptHistoryEntries: [],
    promptHistoryPositionRef: { current: null },
    composerDraftTarget: "thread-1",
    promptRef: { current: "" },
    composerImagesRef: { current: [] },
    composerFilesRef: { current: [] },
    composerTerminalContextsRef: { current: [] },
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerEditorRef: { current: null },
    composerMenuOpenRef: { current: false },
    composerMenuItemsRef: { current: [] },
    activeComposerMenuItemRef: { current: null },
    setComposerCursor: () => {},
    setComposerTrigger: () => {},
    setComposerHighlightedItemId: () => {},
    nudgeComposerMenuHighlight: () => {},
    onSelectComposerItem: () => {},
    resolveActiveComposerTrigger: () => ({ trigger: null }),
    readComposerSnapshot: () => ({ value: "" }),
    applyPromptReplacement: () => false,
    prediction: "Run the tests",
    ...spies,
    ...overrides,
  } as unknown as HandlerInput;
  return { handle: composerCommandKeyHandler(input), spies };
}

describe("composerCommandKeyHandler predictions", () => {
  it("fills the empty composer with the prediction on Tab without sending", () => {
    const { handle, spies } = setup();

    expect(handle("Tab", key("Tab"))).toBe(true);
    expect(spies.setComposerDraftPrompt).toHaveBeenCalledWith("thread-1", "Run the tests");
    expect(spies.submitComposer).not.toHaveBeenCalled();
  });

  it("leaves Tab alone when there is no prediction", () => {
    const { handle, spies } = setup({ prediction: null });

    expect(handle("Tab", key("Tab"))).toBe(false);
    expect(spies.setComposerDraftPrompt).not.toHaveBeenCalled();
  });

  it("keeps Shift+Tab for plan mode while a prediction shows", () => {
    const { handle, spies } = setup();

    expect(handle("Tab", key("Tab", { shiftKey: true }))).toBe(true);
    expect(spies.toggleInteractionMode).toHaveBeenCalledOnce();
    expect(spies.setComposerDraftPrompt).not.toHaveBeenCalled();
  });

  it("hides the prediction on Escape", () => {
    const { handle, spies } = setup();

    expect(handle("Escape", key("Escape"))).toBe(true);
    expect(spies.dismissPrediction).toHaveBeenCalledOnce();
  });

  it("closes an open menu on Escape before touching the prediction", () => {
    const { handle, spies } = setup({ composerMenuOpenRef: { current: true } });

    expect(handle("Escape", key("Escape"))).toBe(true);
    expect(spies.dismissComposerTrigger).toHaveBeenCalledOnce();
    expect(spies.dismissPrediction).not.toHaveBeenCalled();
  });
});
