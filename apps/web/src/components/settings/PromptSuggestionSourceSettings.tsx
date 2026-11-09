import type { PromptSuggestionCustomBehavior } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolvePromptSuggestionModelSelection } from "@t3tools/shared/promptSuggestionBehaviors";
import { msg, T, useGT, useMessages } from "gt-react";

import { randomUUID } from "../../lib/utils";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { useEnvironmentProviders } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useTextGenerationTargets } from "../../textGenerators";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { promptSuggestionBehaviorOptions } from "./promptSuggestionBehaviorOptions";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const SOURCE_LABELS = {
  "built-in": msg("Built-in (Claude and Codex)"),
  model: msg("My model (any provider)"),
} as const;

/** Rows for the "My model" source; shown only while suggestions are on. */
export function PromptSuggestionSourceRows() {
  const settings = useScopedSettings();
  if (!settings.promptSuggestionsEnabled) return null;
  return (
    <>
      <SourceRow />
      {settings.promptSuggestionSource === "model" ? (
        <>
          <ModelRow />
          <BehaviorRow />
          <CustomBehaviorsRow />
        </>
      ) : null}
    </>
  );
}

function SourceRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const source = settings.promptSuggestionSource;
  return (
    <SettingsRow
      serverScoped
      settingKeys={["promptSuggestionSource"]}
      {...searchableSetting("prompt-suggestion-source")}
      description={
        source === "model"
          ? gt(
              "Your recent conversation is sent to the suggestion model's provider. Each suggestion is an extra request on that provider's usage.",
            )
          : gt(
              "Uses Claude's and Codex's own prediction. Behaviors and model choice apply only to My model.",
            )
      }
      control={
        <Select
          value={source}
          onValueChange={(value) => {
            if (value === "built-in" || value === "model") {
              updateSettings({ promptSuggestionSource: value });
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={gt("Suggestion source")}>
            <SelectValue>{m(SOURCE_LABELS[source])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="built-in">{m(SOURCE_LABELS["built-in"])}</SelectItem>
            <SelectItem value="model">{m(SOURCE_LABELS.model)}</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ModelRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const { environment } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const targets = useTextGenerationTargets({
    environmentId: environment?.environmentId ?? null,
    settings,
    providers: providers.filter((provider) => provider.supportsTextGeneration !== false),
    projectId: null,
    selections: [settings.promptSuggestionModelSelection, settings.textGenerationModelSelection],
  });
  const instanceEntries = targets.entries;
  const hasProvider = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const dedicated = settings.promptSuggestionModelSelection !== null;
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolvePromptSuggestionModelSelection(settings),
    },
    targets.providers,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    targets.providers,
    selection.instanceId,
    selection.model,
  );
  const instanceEntry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);
  const speed = useEnvironmentQuery(
    environment
      ? serverEnvironment.promptSuggestionSpeed({
          environmentId: environment.environmentId,
          input: {},
        })
      : null,
  ).data;
  const setModel = (next: ReturnType<typeof createModelSelection>) => {
    const reason = modelDisabledReason(next.instanceId, next.model);
    if (reason) {
      toastManager.add({
        type: "error",
        title: gt("Suggestion model not saved"),
        description: reason,
      });
      return;
    }
    updateSettings({ promptSuggestionModelSelection: next });
  };
  return (
    <SettingsRow
      serverScoped
      settingKeys={["promptSuggestionModelSelection"]}
      {...searchableSetting("prompt-suggestion-model")}
      description={gt(
        "Model and effort for your suggestions. When off, the text generation model is used. Smaller models and low effort are fastest.",
      )}
      control={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {dedicated && hasProvider && instanceEntry ? (
            <>
              <ProviderModelPicker
                environmentId={environment?.environmentId ?? null}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                getModelDisabledReason={modelDisabledReason}
                onInstanceModelChange={(instanceId, model) =>
                  setModel(createModelSelection(instanceId, model))
                }
              />
              <TraitsPicker
                provider={instanceEntry.driverKind}
                models={instanceEntry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  setModel(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            </>
          ) : null}
          <Switch
            checked={dedicated}
            disabled={!dedicated && !hasProvider}
            onCheckedChange={(checked) =>
              updateSettings({
                promptSuggestionModelSelection: checked
                  ? createModelSelection(
                      settings.textGenerationModelSelection.instanceId,
                      settings.textGenerationModelSelection.model,
                      settings.textGenerationModelSelection.options,
                    )
                  : null,
              })
            }
            aria-label={gt("Use a separate suggestion model")}
          />
        </div>
      }
    >
      <p className="pb-3 text-xs text-muted-foreground">
        {speed && speed.medianMs !== null
          ? gt("Recent suggestions took about {seconds} s.", {
              seconds: Math.max(1, Math.round(speed.medianMs / 1000)),
            })
          : gt("No suggestions yet.")}{" "}
        {gt("A suggestion that arrives after you start typing is skipped.")}
      </p>
    </SettingsRow>
  );
}

function BehaviorRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const options = promptSuggestionBehaviorOptions(
    settings.promptSuggestionCustomBehaviors,
    settings.promptSuggestionBehavior,
    m,
  );
  const selected = options.find((option) => option.selected);
  return (
    <SettingsRow
      serverScoped
      settingKeys={["promptSuggestionBehavior"]}
      {...searchableSetting("prompt-suggestion-behavior")}
      description={selected?.description || gt("What your suggestions focus on.")}
      control={
        <Select
          value={selected?.id ?? ""}
          onValueChange={(value) => {
            if (typeof value === "string") updateSettings({ promptSuggestionBehavior: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Suggestion behavior")}
          >
            <SelectValue>{selected?.name}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function CustomBehaviorsRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const behaviors = settings.promptSuggestionCustomBehaviors;
  const save = (next: ReadonlyArray<PromptSuggestionCustomBehavior>) =>
    updateSettings({ promptSuggestionCustomBehaviors: next });
  const update = (id: string, patch: Partial<PromptSuggestionCustomBehavior>) =>
    save(behaviors.map((behavior) => (behavior.id === id ? { ...behavior, ...patch } : behavior)));
  return (
    <SettingsRow
      serverScoped
      settingKeys={["promptSuggestionCustomBehaviors"]}
      {...searchableSetting("prompt-suggestion-custom-behaviors")}
      description={gt(
        "Your own behaviors, shown in the behavior list. Write what suggestions should focus on.",
      )}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={behaviors.length >= 20}
          onClick={() =>
            save([
              ...behaviors,
              { id: `custom-${randomUUID()}`, name: gt("My behavior"), instructions: "" },
            ])
          }
        >
          <T>Add your own</T>
        </Button>
      }
    >
      {behaviors.length > 0 ? (
        <div className="flex max-w-2xl flex-col gap-3 pb-3.5">
          {behaviors.map((behavior) => (
            <div key={behavior.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  key={`${behavior.id}:${behavior.name}`}
                  aria-label={gt("Behavior name")}
                  defaultValue={behavior.name}
                  maxLength={40}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== behavior.name) update(behavior.id, { name });
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    save(behaviors.filter((candidate) => candidate.id !== behavior.id));
                    if (settings.promptSuggestionBehavior === behavior.id) {
                      updateSettings({ promptSuggestionBehavior: "stay-on-track" });
                    }
                  }}
                >
                  {gt("Delete", { $context: "verb, deletes a custom suggestion behavior" })}
                </Button>
              </div>
              <Textarea
                key={`${behavior.id}:${behavior.instructions}`}
                aria-label={gt("Instructions for {name}", { name: behavior.name })}
                rows={3}
                maxLength={1000}
                defaultValue={behavior.instructions}
                placeholder={gt(
                  "For example: I tend to drift. Pull me back to the original goal and suggest the next concrete step.",
                )}
                onBlur={(event) => {
                  const instructions = event.target.value.trim();
                  if (instructions !== behavior.instructions) update(behavior.id, { instructions });
                }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}
