import { describe, expect, it } from "vite-plus/test";

import { promptSuggestionBehaviorOptions } from "./promptSuggestionBehaviorOptions";

const custom = [{ id: "custom-a", name: "Docs first", instructions: "Suggest docs updates." }];

describe("promptSuggestionBehaviorOptions", () => {
  it("lists presets first then custom behaviors", () => {
    const options = promptSuggestionBehaviorOptions(custom, "stay-on-track");

    expect(options[0]).toMatchObject({ id: "stay-on-track", custom: false });
    expect(options.at(-1)).toMatchObject({ id: "custom-a", name: "Docs first", custom: true });
    expect(options.filter((option) => option.custom)).toHaveLength(1);
  });

  it("marks the selected id, falling back to stay-on-track when unknown", () => {
    expect(
      promptSuggestionBehaviorOptions(custom, "custom-a").find((option) => option.selected)?.id,
    ).toBe("custom-a");
    expect(
      promptSuggestionBehaviorOptions(custom, "custom-gone").find((option) => option.selected)?.id,
    ).toBe("stay-on-track");
  });
});
