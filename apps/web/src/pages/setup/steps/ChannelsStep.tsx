import { useMemo, useState } from "react";
import type { SettingsFormApi } from "../../../lib/use-settings-form";
import { usePlugins, type UsePluginsApi } from "../../../lib/use-plugins";
import { useChannelsCatalog } from "../../../lib/use-channels-catalog";
import { apiRequest } from "../../../lib/api";
import type { ChannelHints, ChannelConfigField } from "../../../lib/types";
import { Toast, Toggle, useToast } from "../../../components/AdminUI";
import { channelDownloadedMessage } from "../../../lib/marketplace-messages";
import { SaveStatus } from "../../../components/SettingsUI";
import { postSettings, useAutoSave, useSaveCoordinator } from "../../../lib/config-save-context";

const buttonClass = "rounded-control border border-strong bg-bg-3 px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-60";
const inputClass = "w-full rounded-control border border-strong bg-bg-3 px-3 py-2 font-mono text-sm outline-none focus:border-accent";
const labelClass = "mb-1 block font-mono text-micro uppercase tracking-wide text-txt-3";

function formatName(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Channels whose config has a matching slice in SettingsFormState and can be saved today. */
type ConfigurableSlug = "telegram" | "whatsapp";
const CONFIGURABLE_SLUGS: ConfigurableSlug[] = ["telegram", "whatsapp"];

/** Hint keys that a rendered config field already covers — dropped from the active-hint list. */
const FIELD_HINT_KEYS = new Set(["uninstalled", "inactive", "allowUnlisted", "whitelist"]);

/**
 * Setup-wizard form for one channel, rendered from the hub catalog's `configFields`.
 * Only channels in CONFIGURABLE_SLUGS can be persisted today; a new hub channel
 * needs a matching SettingsFormState slice + settings patch before its
 * `configFields` can be wired here.
 */
function ChannelConfigForm({
  slug,
  name,
  fields,
  api,
  autoSave,
}: {
  autoSave?: boolean;
  slug: ConfigurableSlug;
  name: string;
  fields: ChannelConfigField[];
  api: SettingsFormApi;
}) {
  const saves = useSaveCoordinator();
  const initial = api.form[slug] as unknown as Record<string, string | boolean>;
  const draft = useAutoSave(`channels.${slug}`, initial, async (values) => {
    const patch = Object.fromEntries(fields.filter((field) => field.type !== 'password' || values[field.name]).map((field) => [field.name, values[field.name]]));
    await postSettings({ channels: { [slug]: patch } });
  }, (values) => {
    const invalid = fields.find((field) => field.required && field.type !== 'password' && field.type !== 'boolean' && !String(values[field.name] ?? '').trim());
    return invalid ? `${invalid.label} is required.` : null;
  });
  const slice = autoSave ? draft.value : initial;

  const setValue = (fieldName: string, value: string | boolean) => {
    if (autoSave) {
      draft.update((previous) => ({ ...previous, [fieldName]: value }), typeof value === 'boolean');
    }
    api.update((prev) => ({
      ...prev,
      [slug]: { ...(prev[slug] as Record<string, unknown>), [fieldName]: value },
    }) as typeof prev);
  };

  const storedSecretMasked = (fieldName: string): boolean => {
    const channels = api.original?.CHANNELS as Record<string, Record<string, unknown>> | undefined;
    const stored = channels?.[slug.toUpperCase()]?.[fieldName.toUpperCase()];
    return typeof stored === "string" && stored.includes("••••");
  };

  const textFields = fields.filter((f) => f.type !== "boolean");
  const boolFields = fields.filter((f) => f.type === "boolean");

  return (
    <div className="space-y-3">
      {textFields.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {textFields.map((field) => (
            <div key={field.name}>
              <label htmlFor={`${slug}-${field.name}`} className={labelClass}>{field.label}</label>
              <input
                id={`${slug}-${field.name}`}
                type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                value={String(slice[field.name] ?? "")}
                onChange={(e) => setValue(field.name, e.target.value)}
                className={`${inputClass} font-mono`}
                placeholder={
                  field.type === "password" && storedSecretMasked(field.name)
                    ? "Leave blank to keep current value"
                    : field.placeholder
                }
              />
              {field.description && (
                <p className="mt-1 font-mono text-mini text-txt-3">{field.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {slug === "telegram" && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={api.testingTelegram || !api.form.telegram.bot_token}
            onClick={() => api.testTelegramToken()}
            className={`${buttonClass} w-full sm:w-auto`}
          >
            {api.testingTelegram ? "Testing…" : "Test token"}
          </button>
          {api.telegramTestResult && (
            <span
              className={`font-mono text-mini break-words min-w-0 ${
                api.telegramTestResult.ok ? "text-success" : "text-danger-2"
              }`}
            >
              {api.telegramTestResult.ok
                ? `valid — @${api.telegramTestResult.username ?? "?"}`
                : (api.telegramTestResult.error ?? "invalid token")}
            </span>
          )}
        </div>
      )}

      {slug === "whatsapp" && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={api.whatsappConnecting}
            onClick={async () => { if (autoSave) await saves.flush(`channels.${slug}`); await api.connectWhatsApp(); }}
            className={`${buttonClass} w-full sm:w-auto`}
          >
            {api.whatsappConnecting ? "Connecting…" : "Connect"}
          </button>
          {api.whatsappConnectResult && (
            <span className="font-mono text-mini break-words min-w-0 text-txt-3">
              {api.whatsappConnectResult}
            </span>
          )}
        </div>
      )}

      {autoSave && <SaveStatus {...draft} />}

      {boolFields.map((field) => (
        <div key={field.name} className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm">{field.label}</div>
            {field.description && (
              <div className="font-mono text-mini text-txt-3">{field.description}</div>
            )}
          </div>
          <Toggle
            checked={Boolean(slice[field.name])}
            onChange={() => setValue(field.name, !slice[field.name])}
            label={`${field.label} on ${name}`}
          />
        </div>
      ))}
    </div>
  );
}

export function ChannelsStep({
  api,
  pluginsApi: providedPluginsApi,
  autoSave = false,
}: {
  api?: SettingsFormApi;
  pluginsApi?: UsePluginsApi;
  onlyEnabled?: boolean;
  autoSave?: boolean;
} = {}) {
  const saves = useSaveCoordinator();
  const localPluginsApi = usePlugins();
  const pluginsApi = providedPluginsApi ?? localPluginsApi;
  const { items: catalogItems, loading: catalogLoading, reload: catalogReload } = useChannelsCatalog();

  const [downloading, setDownloading] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [toastMsg, showToast, toastIsError] = useToast();

  const channels = useMemo(() => {
    const map = new Map<
      string,
      { slug: string; name: string; summary?: string; hints?: ChannelHints; configFields?: ChannelConfigField[] }
    >();

    for (const item of catalogItems) {
      map.set(item.slug, {
        slug: item.slug,
        name: item.name,
        summary: item.summary,
        hints: item.hints,
        configFields: item.configFields,
      });
    }

    for (const item of pluginsApi.items) {
      if (item.family === "channels" && !map.has(item.name)) {
        map.set(item.name, {
          slug: item.name,
          name: formatName(item.name),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogItems, pluginsApi.items]);

  /**
   * Downloads only — it deliberately does NOT enable the channel. A channel
   * can't work before its configuration exists (whitelist, token, paired
   * device), so it lands in the "Installed (Inactive)" state with its config
   * form and an Activate button, and the toast says so.
   */
  async function handleDownloadChannel(slug: string, name: string) {
    setDownloading(slug);
    setDownloadError(null);
    try {
      await apiRequest(`/marketplace/${slug}/pull`, { method: "POST" });
      await pluginsApi.reload();
      await catalogReload();
      showToast(channelDownloadedMessage(name));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : `Failed to download ${slug}`);
    } finally {
      setDownloading(null);
    }
  }

  async function handleToggleChannel(slug: string, enabled: boolean) {
    setActivating(slug);
    setDownloadError(null);
    try {
      if (autoSave) await saves.flush(`channels.${slug}`);
      await apiRequest(`/plugins/channels/${slug}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await pluginsApi.reload();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : `Failed to update ${slug}`);
    } finally {
      setActivating(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center sm:text-left">
        <p className="text-sm font-medium">{autoSave ? "Messaging channels" : "Chat channels (optional)"}</p>
        <p className="mt-1 font-mono text-mini text-txt-3">
          {autoSave ? "Connect your messaging apps and manage who can reach your assistant." : "Download and activate chat channels to communicate with your agent via messaging apps, or click Next to proceed with Web & TUI only."}
        </p>
      </div>

      {downloadError && (
        <div className="rounded-control border border-danger bg-danger-muted px-4 py-2.5 text-xs text-danger">
          {downloadError}
        </div>
      )}

      {catalogLoading && channels.length === 0 && (
        <div className="rounded-control border border-subtle bg-bg-3 p-6 text-center font-mono text-xs text-txt-3">
          Loading channels…
        </div>
      )}

      {!catalogLoading && channels.length === 0 && (
        <div className="rounded-control border border-subtle bg-bg-3 p-6 text-center font-mono text-xs text-txt-3">
          No channels found.
        </div>
      )}

      {channels.map((channel) => {
        const plugin = pluginsApi.items.find((i) => i.family === "channels" && i.name === channel.slug);
        const isInstalled = !!plugin;
        const isEnabled = plugin?.enabled ?? false;

        const configFields = channel.configFields ?? [];
        const isConfigurable =
          CONFIGURABLE_SLUGS.includes(channel.slug as ConfigurableSlug) && configFields.length > 0;

        // Drop hints a rendered config field already covers, but only when the form shows.
        const activeHints = Object.entries(channel.hints ?? {})
          .filter(([key, val]) => Boolean(val)
            && key !== "uninstalled"
            && key !== "inactive"
            && !(isConfigurable && FIELD_HINT_KEYS.has(key)));

        return (
          <div key={channel.slug} className="rounded-control border border-subtle bg-bg-3 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-subtle pb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{channel.name}</span>
                {!isInstalled ? (
                  <span className="font-mono text-micro uppercase text-warn border border-warn rounded px-1.5 py-0.5">
                    Not installed
                  </span>
                ) : !isEnabled ? (
                  <span className="font-mono text-micro uppercase text-txt-3 border border-subtle rounded px-1.5 py-0.5">
                    Installed (Inactive)
                  </span>
                ) : (
                  <span className="font-mono text-micro uppercase text-success border border-success rounded px-1.5 py-0.5">
                    Active
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!isInstalled ? (
                  <button
                    type="button"
                    disabled={downloading === channel.slug}
                    onClick={() => handleDownloadChannel(channel.slug, channel.name)}
                    className={`${buttonClass} whitespace-nowrap`}
                  >
                    {downloading === channel.slug ? "Downloading…" : `Download ${channel.name}`}
                  </button>
                ) : !isEnabled ? (
                  <button
                    type="button"
                    disabled={activating === channel.slug}
                    onClick={() => handleToggleChannel(channel.slug, true)}
                    className={`${buttonClass} whitespace-nowrap`}
                  >
                    {activating === channel.slug ? "Activating…" : `Activate ${channel.name}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={activating === channel.slug}
                    onClick={() => handleToggleChannel(channel.slug, false)}
                    className="rounded-control border border-subtle bg-bg px-3 py-1.5 font-mono text-mini text-txt-3 hover:border-danger hover:text-danger-2 disabled:opacity-50 whitespace-nowrap"
                  >
                    {activating === channel.slug ? "Deactivating…" : "Deactivate"}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3">
              {!isInstalled ? (
                (channel.hints?.uninstalled || channel.summary) ? (
                  <p className="font-mono text-mini text-txt-3">
                    {channel.hints?.uninstalled || channel.summary}
                  </p>
                ) : null
              ) : !isEnabled ? (
                channel.hints?.inactive ? (
                  <p className="font-mono text-mini text-txt-3">
                    {channel.hints.inactive}
                  </p>
                ) : (
                  <p className="font-mono text-mini text-txt-3">
                    {channel.name} channel is installed locally. Click Activate above to enable it.
                  </p>
                )
              ) : (
                <div className="space-y-4">
                  {activeHints.length > 0 ? (
                    <div className="space-y-1.5">
                      {activeHints.map(([key, hint]) => (
                        <p key={key} className="font-mono text-mini text-txt-3">
                          {hint}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {api && isConfigurable && (
                    <div className="mt-3 pt-3 border-t border-subtle space-y-3">
                      <ChannelConfigForm
                        slug={channel.slug as ConfigurableSlug}
                        name={channel.name}
                        fields={configFields}
                        api={api}
                        autoSave={autoSave}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <Toast message={toastMsg} isError={toastIsError} />
    </div>
  );
}
