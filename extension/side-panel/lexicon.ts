import panelLexiconData from './lexicon.json';

export type PanelLexiconLanguage = keyof typeof panelLexiconData.locales;
export type PanelLocaleText = (typeof panelLexiconData)['locales']['zh'];

const panelLocales = panelLexiconData.locales as Record<PanelLexiconLanguage, PanelLocaleText>;

export const DEFAULT_PANEL_LANGUAGE = panelLexiconData.defaultLocale as PanelLexiconLanguage;

export function getPanelLocale(language: PanelLexiconLanguage): PanelLocaleText {
  return panelLocales[language] ?? panelLocales[DEFAULT_PANEL_LANGUAGE];
}

export function getDefaultPanelLocale(): PanelLocaleText {
  return getPanelLocale(DEFAULT_PANEL_LANGUAGE);
}

export function formatPanelMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
