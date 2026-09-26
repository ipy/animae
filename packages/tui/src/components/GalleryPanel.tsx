import { Box, Text } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { GalleryItemView } from "@animae/engine";
import { useEngineContext } from "../context/engine-context.tsx";
import { Overlay } from "./Overlay.tsx";
import { useTuiI18n } from "../i18n/context.tsx";
import type { GalleryPresentationFn } from "../types.ts";

export function GalleryPanel({
  selected,
  revealed,
  onToggleReveal,
  presentation,
  locale,
  onRefresh,
}: {
  selected: number;
  revealed: Set<string>;
  onToggleReveal: (id: string) => void;
  presentation?: GalleryPresentationFn;
  locale: string;
  onRefresh: () => void;
}) {
  const { t } = useTuiI18n();
  const { engine } = useEngineContext();
  const [items, setItems] = useState<GalleryItemView[]>([]);

  const reload = useCallback(() => {
    void engine.gallery.list({ locale }).then(setItems);
  }, [engine, locale]);

  useEffect(() => {
    reload();
  }, [reload]);

  const row = items[selected];
  const pres = row && presentation ? presentation(row) : undefined;
  const masked = Boolean(pres?.blur) && row && !revealed.has(row.id);

  return (
    <Overlay title={t("gallery.title")} width={78} height={22}>
      <Box flexDirection="column">
        {items.length === 0 ? (
          <Text dimColor>{t("gallery.empty")}</Text>
        ) : (
          items.map((item, i) => {
            const p = presentation ? presentation(item) : undefined;
            const hide = Boolean(p?.blur) && !revealed.has(item.id);
            const title = hide ? t("gallery.masked_title") : item.title;
            const job = item.job;
            const prog =
              job?.progress != null ? ` ${Math.round(job.progress * 100)}%` : "";
            return (
              <Text key={item.id} color={i === selected ? "green" : undefined}>
                {i === selected ? "▸ " : "  "}
                {title} [{item.rating}] {item.unlocked ? "" : t("gallery.locked_tag")}
                {job ? ` (${job.state}${prog})` : ""}
              </Text>
            );
          })
        )}
      </Box>
      {row ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            {masked ? t("gallery.reveal_hint") : row.caption ?? row.hint ?? ""}
          </Text>
          {row.image ? (
            <Text dimColor>
              {t("gallery.image_line", {
                path: row.image.path,
                w: row.image.width,
                h: row.image.height,
              })}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>{t("gallery.keys_footer")}</Text>
      </Box>
    </Overlay>
  );
}
