import { Box, Text } from "ink";
import { useAppState } from "../context/app-state-context.tsx";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { Overlay } from "./Overlay.tsx";
import { useTheme } from "../hooks/use-theme.ts";

export function PromptDialog() {
  const theme = useTheme();
  const { state, dispatch } = useAppState();
  const { completePrompt } = useActionRunner();
  const prompt = state.prompt;
  if (!prompt) return null;

  const field = prompt.fields[prompt.fieldIndex];
  if (!field) return null;

  const value = prompt.values[field.id] ?? "";

  return (
    <Overlay title={prompt.title}>
      <Text>
        {field.label}
        {field.type === "select" && field.options ? (
          <Text dimColor> (↑↓ 选择 · Enter 确认 · Esc 取消)</Text>
        ) : (
          <Text dimColor> (Enter 确认 · Esc 取消)</Text>
        )}
      </Text>
      {field.type === "select" && field.options ? (
        <Box flexDirection="column" marginTop={1}>
          {field.options.map((opt, i) => (
            <Text
              key={opt.value}
              color={value === opt.value ? theme.colors.player : theme.colors.dim}
            >
              {value === opt.value ? "▸ " : "  "}
              {opt.label}
            </Text>
          ))}
        </Box>
      ) : (
        <Text color={theme.colors.primary}>{value || "…"}</Text>
      )}
    </Overlay>
  );
}

/** Keyboard handler for prompt — call from TuiShell when state.prompt set. */
export async function handlePromptKey(
  state: import("../context/app-state-context.tsx").AppState,
  dispatch: import("react").Dispatch<import("../context/app-state-context.tsx").AppStateAction>,
  completePrompt: (v: Record<string, string>) => Promise<void>,
  ev: { key: import("ink").Key; input: string; name: string },
): Promise<boolean> {
  const prompt = state.prompt;
  if (!prompt) return false;
  const field = prompt.fields[prompt.fieldIndex];
  if (!field) return false;

  if (ev.key.escape) {
    dispatch({ type: "setPrompt", prompt: undefined });
    return true;
  }

  const values = { ...prompt.values };

  if (field.type === "select" && field.options) {
    const idx = field.options.findIndex((o) => o.value === values[field.id]);
    if (ev.key.upArrow) {
      const next = Math.max(0, (idx >= 0 ? idx : 0) - 1);
      values[field.id] = field.options[next]!.value;
      dispatch({ type: "patchPrompt", patch: { values } });
      return true;
    }
    if (ev.key.downArrow) {
      const next = Math.min(field.options.length - 1, (idx >= 0 ? idx : -1) + 1);
      values[field.id] = field.options[next]!.value;
      dispatch({ type: "patchPrompt", patch: { values } });
      return true;
    }
    if (ev.key.return) {
      if (!values[field.id] && field.options[0]) values[field.id] = field.options[0].value;
      if (prompt.fieldIndex + 1 < prompt.fields.length) {
        dispatch({ type: "patchPrompt", patch: { values, fieldIndex: prompt.fieldIndex + 1 } });
        return true;
      }
      await completePrompt(values);
      return true;
    }
    return true;
  }

  if (ev.key.backspace) {
    values[field.id] = (values[field.id] ?? "").slice(0, -1);
    dispatch({ type: "patchPrompt", patch: { values } });
    return true;
  }
  if (ev.key.return) {
    if (prompt.fieldIndex + 1 < prompt.fields.length) {
      dispatch({ type: "patchPrompt", patch: { values, fieldIndex: prompt.fieldIndex + 1 } });
      return true;
    }
    await completePrompt(values);
    return true;
  }
  if (ev.input && !ev.key.ctrl) {
    values[field.id] = (values[field.id] ?? "") + ev.input;
    dispatch({ type: "patchPrompt", patch: { values } });
    return true;
  }
  return true;
}
