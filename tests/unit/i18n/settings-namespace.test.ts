import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const settings = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'packages',
      'shared',
      'src',
      'i18n',
      'locales',
      'en',
      'settings.json'
    ),
    'utf8'
  )
)

describe('settings namespace (en)', () => {
  it('keeps the pre-existing general.language keys untouched', () => {
    expect(settings.general.language.label).toBe('Language')
    expect(settings.general.language.description).toBe(
      "The language Actovia's interface is shown in."
    )
    expect(settings.general.language.auto).toBe('Auto (detect from system)')
  })

  it('has the general.theme / runOnStartup / menuBar keys', () => {
    expect(settings.general.theme.label).toBe('Theme')
    expect(settings.general.theme.description).toBe(
      'Choose light, dark, or match your system preference'
    )
    expect(settings.general.theme.system).toBe('System')
    expect(settings.general.theme.light).toBe('Light')
    expect(settings.general.theme.dark).toBe('Dark')
    expect(settings.general.runOnStartup.label).toBe('Run on startup')
    expect(settings.general.runOnStartup.description).toBe(
      'Automatically start Actovia when you log in'
    )
    expect(settings.general.menuBar.label).toBe('Menu bar')
    expect(settings.general.menuBar.description).toBe(
      'Show Actovia in the menu bar'
    )
  })

  it('has a nav title key for every SettingsLabel tab', () => {
    expect(settings.nav.profile.title).toBe('Profile')
    expect(settings.nav.general.title).toBe('General')
    expect(settings.nav.personality.title).toBe('Personality')
    expect(settings.nav.aiProviders.title).toBe('AI Providers')
    expect(settings.nav.amazonS3.title).toBe('AWS S3')
    expect(settings.nav.mcpServers.title).toBe('MCP Servers')
    expect(settings.nav.skillsMarket.title).toBe('Skills Market')
    expect(settings.nav.knowledgeBase.title).toBe('Knowledge Base')
    expect(settings.nav.builtinTools.title).toBe('Built-in Tools')
    expect(settings.nav.memory.title).toBe('Memory')
    expect(settings.nav.discover.title).toBe('Discover')
    expect(settings.nav.voice.title).toBe('Voice')
    expect(settings.nav.deepResearch.title).toBe('Deep Research')
    expect(settings.nav.computerUse.title).toBe('Computer Use')
    expect(settings.nav.dataControls.title).toBe('Data Controls')
    expect(settings.nav.logger.title).toBe('Logger')
    expect(settings.nav.keyboardShortcuts.title).toBe('Keyboard Shortcuts')
    expect(settings.nav.about.title).toBe('About')
  })

  it('has the General colour-tone keys', () => {
    expect(settings.general.colorTone.label).toBe('Color tone')
    expect(settings.general.colorTone.description).toBe(
      'Choose a color accent for the interface'
    )
    expect(Object.keys(settings.general.colorTone.tones)).toEqual([
      'neutral',
      'emerald',
      'blue',
      'violet',
      'rose',
      'orange',
      'yellow'
    ])
  })

  it('has the nav group heading keys', () => {
    expect(settings.nav.group.personal).toBe('Personal')
    expect(settings.nav.group.aiTools).toBe('AI & Tools')
    expect(settings.nav.group.integrations).toBe('Integrations')
    expect(settings.nav.group.storage).toBe('Storage')
    expect(settings.nav.group.developer).toBe('Developer')
  })

  it('has the sidebar chrome keys', () => {
    expect(settings.common.searchPlaceholder).toBe('Search settings…')
    expect(settings.common.backToApp).toBe('Back to app')
  })

  it('has a keyboard shortcut label for every SHORTCUT_MAP entry', () => {
    expect(settings.keyboardShortcuts.category.general).toBe('General')
    expect(settings.keyboardShortcuts.category.chat).toBe('Chat')
    expect(settings.keyboardShortcuts.category.search).toBe('Search')
    expect(settings.keyboardShortcuts.shortcuts['new-chat'].label).toBe(
      'New chat'
    )
    expect(settings.keyboardShortcuts.shortcuts['open-settings'].label).toBe(
      'Open settings'
    )
    expect(settings.keyboardShortcuts.shortcuts['toggle-sidebar'].label).toBe(
      'Toggle sidebar'
    )
    expect(
      settings.keyboardShortcuts.shortcuts['toggle-developer-tools'].label
    ).toBe('Toggle developer tools')
    expect(
      settings.keyboardShortcuts.shortcuts['force-refresh-page'].label
    ).toBe('Force refresh page')
    expect(settings.keyboardShortcuts.shortcuts['lock-now'].label).toBe(
      'Lock now'
    )
    expect(settings.keyboardShortcuts.shortcuts['find-in-page'].label).toBe(
      'Find in page'
    )
    expect(
      settings.keyboardShortcuts.shortcuts['search-chat-history'].label
    ).toBe('Search chat history')
    expect(settings.keyboardShortcuts.shortcuts['close-find-bar'].label).toBe(
      'Close find bar'
    )
    expect(settings.keyboardShortcuts.shortcuts['close-tab'].label).toBe(
      'Close chat'
    )
    expect(settings.keyboardShortcuts.shortcuts['go-back'].label).toBe('Back')
    expect(settings.keyboardShortcuts.shortcuts['go-forward'].label).toBe(
      'Forward'
    )
    expect(settings.keyboardShortcuts.shortcuts['focus-chat-input'].label).toBe(
      'Focus chat input'
    )
    expect(settings.keyboardShortcuts.shortcuts['send-message'].label).toBe(
      'Send message'
    )
    expect(settings.keyboardShortcuts.shortcuts['new-line'].label).toBe(
      'New line'
    )
  })

  it('has the About tab labels', () => {
    expect(settings.about.version).toBe('Version')
    expect(settings.about.electron).toBe('Electron')
    expect(settings.about.chromium).toBe('Chromium')
    expect(settings.about.node).toBe('Node.js')
    expect(settings.about.v8).toBe('V8')
    expect(settings.about.os).toBe('OS')
    expect(settings.about.github).toBe('GitHub')
    expect(settings.about.twitter).toBe('X (Twitter)')
    expect(settings.about.website).toBe('Website')
    expect(settings.about.license).toBe('License')
    expect(settings.about.autoUpdate.label).toBe('Auto Update')
    expect(settings.about.autoUpdate.description).toBe(
      'Automatically download and install updates when available'
    )
  })

  it('has the updater panel keys for every state', () => {
    expect(settings.about.update.checkPrompt).toBe(
      'Check for the latest version'
    )
    expect(settings.about.update.checkButton).toBe('Check for Updates')
    expect(settings.about.update.checking).toBe('Checking for updates…')
    expect(settings.about.update.upToDate).toBe("You're on the latest version")
    expect(settings.about.update.checkAgain).toBe('Check again')
    expect(settings.about.update.available).toBe('Update available')
    expect(settings.about.update.availableVersion).toBe('Version {{version}}')
    expect(settings.about.update.download).toBe('Download')
    expect(settings.about.update.downloading).toBe('Downloading update…')
    expect(settings.about.update.ready).toBe('Update ready to install')
    expect(settings.about.update.readyDescription).toBe(
      'Restart to apply the update'
    )
    expect(settings.about.update.restartAndInstall).toBe('Restart & Install')
    expect(settings.about.update.failed).toBe('Update failed')
  })

  it('has the Personality tab keys', () => {
    expect(settings.personality.baseStyle.label).toBe('Base style and tone')
    expect(settings.personality.baseStyle.description).toBe(
      'Set the style and tone of how Actovia responds to you'
    )
    expect(settings.personality.baseStyle.options).toMatchObject({
      default: 'Default',
      professional: 'Professional',
      friendly: 'Friendly',
      candid: 'Candid',
      quirky: 'Quirky',
      efficient: 'Efficient',
      cynical: 'Cynical'
    })
    expect(settings.personality.level).toMatchObject({
      default: 'Default',
      more: 'More',
      less: 'Less'
    })
    expect(settings.personality.warm).toBe('Warm')
    expect(settings.personality.enthusiastic).toBe('Enthusiastic')
    expect(settings.personality.headersAndLists).toBe('Headers & Lists')
    expect(settings.personality.emoji).toBe('Emoji')
    expect(settings.personality.customInstructions.label).toBe(
      'Custom instructions'
    )
    expect(settings.personality.customInstructions.placeholder).toBe(
      'Additional behavior, style, and tone preferences'
    )
    expect(settings.personality.nickname.label).toBe('Nickname')
    expect(settings.personality.nickname.placeholder).toBe(
      'What should Actovia call you?'
    )
    expect(settings.personality.occupation.label).toBe('Occupation')
    expect(settings.personality.occupation.placeholder).toBe(
      'e.g., Software engineer, Designer'
    )
    expect(settings.personality.aboutYou.label).toBe('More about you')
    expect(settings.personality.aboutYou.placeholder).toBe(
      'Interests, values, or preferences to keep in mind'
    )
  })

  it('has the Profile tab keys', () => {
    expect(settings.profile.stats).toMatchObject({
      lifetimeTokens: 'Lifetime tokens',
      peakDay: 'Peak day',
      currentStreak: 'Current streak',
      longestStreak: 'Longest streak'
    })
    expect(settings.profile.activity.heading).toBe('Token activity')
    expect(settings.profile.activity.mode).toMatchObject({
      daily: 'Daily',
      cumulative: 'Cumulative'
    })
    expect(settings.profile.activity.cellTooltip).toBe(
      '{{date}} · {{tokens}} tokens'
    )
    expect(settings.profile.insights).toMatchObject({
      sectionTitle: 'Activity insights',
      totalChats: 'Total chats',
      modelRequests: 'Model requests',
      installedSkills: 'Installed skills',
      activeSkills: 'Active skills'
    })
    expect(settings.profile.topModels).toMatchObject({
      sectionTitle: 'Top models',
      empty: 'No model usage yet'
    })
    expect(settings.profile.avatar).toMatchObject({
      uploadLabel: 'Upload your avatar',
      alt: 'Your avatar'
    })
  })

  it('has the provider dropdown and tab-chrome keys', () => {
    expect(settings.providers.config).toMatchObject({
      label: 'Provider',
      description: 'The AI provider to use for chat',
      placeholder: 'Select a provider'
    })
    expect(settings.providers.keys.sectionTitle).toBe('Provider keys')
  })

  it('has the shared provider field keys', () => {
    expect(settings.providers.fields.apiKey).toMatchObject({
      label: 'API Key',
      description: 'Your {{provider}} API key'
    })
    expect(settings.providers.fields.baseUrl).toMatchObject({
      label: 'Base URL',
      description: 'Custom API endpoint. Leave empty for default'
    })
  })

  it('has the Azure-specific provider field keys', () => {
    expect(settings.providers.azure.endpoint).toMatchObject({
      label: 'Endpoint',
      description: 'Your Azure OpenAI resource endpoint URL'
    })
    expect(settings.providers.azure.apiVersion).toMatchObject({
      label: 'API Version',
      description: 'Azure OpenAI API version string'
    })
    expect(settings.providers.azure.model).toMatchObject({
      label: 'Model',
      description: 'The Azure deployment name to use'
    })
  })

  it('has the Ollama-specific provider field keys', () => {
    expect(settings.providers.ollama.baseUrl).toMatchObject({
      label: 'Base URL',
      description: 'Ollama server address for local model inference'
    })
    expect(settings.providers.ollama.status).toMatchObject({
      label: 'Status',
      description: 'Connection status of the Ollama server',
      running: 'Ollama is running',
      notRunning: 'Not running'
    })
  })

  it('has the ModelPicker keys', () => {
    expect(settings.providers.model.label).toBe('Model')
    expect(settings.providers.model.description).toBe(
      'The model used for this provider'
    )
    expect(settings.providers.model.searchPlaceholder).toBe('Search models…')
    expect(settings.providers.model.noModelsFound).toBe('No models found.')
    expect(settings.providers.model.refreshHint).toBe(
      'Refresh to see all available models.'
    )
    expect(settings.providers.model.staleWarning).toBe(
      '"{{model}}" is no longer offered by this provider — pick a current model.'
    )
    expect(settings.providers.model.retrieving).toBe('Retrieving…')
    expect(settings.providers.model.refreshing).toBe('Refreshing…')
    expect(settings.providers.model.retrieve).toBe('Retrieve model list')
    expect(settings.providers.model.refresh).toBe('Refresh model list')
    expect(settings.providers.model.fetchErrorTitle).toBe(
      'Could not fetch model list'
    )
    expect(settings.providers.model.fetchErrorFallback).toBe(
      'Failed to fetch model list'
    )
  })

  it('has the tools registry and group-title keys', () => {
    expect(settings.tools.groups).toMatchObject({
      web: 'Web',
      fileSystem: 'File System',
      aiData: 'AI & Data',
      maps: 'Maps'
    })
    expect(settings.tools.registry.weather).toMatchObject({
      label: 'Weather',
      description: 'Look up current weather and forecasts by location'
    })
    expect(settings.tools.registry.webSearch).toMatchObject({
      label: 'Web Search',
      description: 'Search the web via Brave Search API (requires API key)'
    })
    expect(settings.tools.registry.webFetch).toMatchObject({
      label: 'Web Fetch',
      description: 'Fetch the content of a URL (docs, APIs, GitHub files)'
    })
    expect(settings.tools.registry.terminal).toMatchObject({
      label: 'Terminal',
      description: 'Execute shell commands on your machine'
    })
    expect(settings.tools.registry.readFile).toMatchObject({
      label: 'Read File',
      description: 'Read file contents by path'
    })
    expect(settings.tools.registry.writeFile).toMatchObject({
      label: 'Write File',
      description: 'Create or overwrite files'
    })
    expect(settings.tools.registry.editFile).toMatchObject({
      label: 'Edit File',
      description: 'Targeted string replacement in existing files'
    })
    expect(settings.tools.registry.listDirectory).toMatchObject({
      label: 'List Directory',
      description: 'List files and folders in a directory'
    })
    expect(settings.tools.registry.findFiles).toMatchObject({
      label: 'Find Files',
      description: 'Search for files by glob pattern'
    })
    expect(settings.tools.registry.grep).toMatchObject({
      label: 'Grep',
      description: 'Search file contents by regex pattern'
    })
    expect(settings.tools.registry.imageGeneration).toMatchObject({
      label: 'Image Generation',
      description: 'Generate images via DALL-E (requires OpenAI API key)'
    })
    expect(settings.tools.registry.searchKnowledgeBase).toMatchObject({
      label: 'Knowledge Base',
      description:
        'Retrieve context from your knowledge base (requires a configured LightRAG URL)'
    })
    expect(settings.tools.registry.mapItinerary).toMatchObject({
      label: 'Map Itinerary',
      description:
        'Render places, routes, and multi-day trips on a single interactive map card'
    })
  })

  it('has the Google Maps tool-config panel keys', () => {
    expect(settings.tools.googleMaps.apiKey).toMatchObject({
      label: 'Google API Key',
      description:
        'Powers Maps Routing (point-to-point directions) and Places (location lookup). Get one from the Google Cloud console.',
      placeholder: 'Enter your Google API key'
    })
  })

  it('has the Image Generation tool-config panel keys', () => {
    expect(settings.tools.imageGeneration.model).toMatchObject({
      label: 'Model',
      description: 'OpenAI only — uses your configured OpenAI API key.',
      placeholder: 'Select a model'
    })
    expect(settings.tools.imageGeneration.size).toMatchObject({
      label: 'Size',
      description: 'The dimensions of the generated image.'
    })
    expect(settings.tools.imageGeneration.quality).toMatchObject({
      label: 'Quality',
      description: 'The quality level of the generated image.'
    })
    expect(settings.tools.imageGeneration.outputFormat).toMatchObject({
      label: 'Output Format',
      description:
        'If the background is transparent, the output format should be set to either png (default) or webp.'
    })
    expect(settings.tools.imageGeneration.generatedCounts).toMatchObject({
      label: 'Generated Counts',
      description: 'The number of images to generate. Must be between 1 and 10.'
    })
    expect(settings.tools.imageGeneration.background).toMatchObject({
      label: 'Background',
      description: 'Set the background style for the generated image.'
    })
  })

  it('has the Web Search tool-config panel keys', () => {
    expect(settings.tools.webSearch.apiKey).toMatchObject({
      label: 'Brave Search API Key',
      description:
        'Required for web search. Get yours at api-dashboard.search.brave.com'
    })
    expect(settings.tools.webSearch.country).toMatchObject({
      label: 'Country',
      description: 'Bias results toward a specific region',
      placeholder: 'Select country...',
      empty: 'No country found.'
    })
    expect(settings.tools.webSearch.languages).toMatchObject({
      label: 'Languages',
      description: 'Filter search results by language',
      placeholder: 'Search languages...',
      empty: 'No language found.'
    })
    expect(settings.tools.webSearch.maxResults).toMatchObject({
      label: 'Max Results',
      description: 'Sources a search brings back (1–20). Default: 10.'
    })
    expect(settings.tools.webSearch.deepRecall).toMatchObject({
      label: 'Deep recall',
      description:
        'Search three phrasings of the question and add a broader pass — forums, news, pages the first search drops. More sources and more tokens per search, and about six Brave requests instead of one.'
    })
    expect(settings.tools.webSearch.recency.label).toBe('Recency Filter')
    expect(settings.tools.webSearch.recency.description).toBe(
      'Only return results from a recent time period.'
    )
    expect(settings.tools.webSearch.recency.options).toMatchObject({
      none: 'No filter',
      hour: 'Past hour',
      day: 'Past 24 hours',
      week: 'Past week',
      month: 'Past month',
      year: 'Past year'
    })
    expect(settings.tools.webSearch.domainFilter).toMatchObject({
      label: 'Domain Filter',
      description:
        'Comma-separated. Prefix with - to exclude. e.g. "nature.com, .edu" or "-reddit.com"'
    })
  })

  it('has the Voice tab keys', () => {
    expect(settings.tools.voice.alert).toBe(
      'The Text-to-Speech and Speech-to-Text services <strong>only support OpenAI</strong>. Please make sure you have configured the OpenAI API setting correctly before using these features.'
    )
    expect(settings.tools.voice.speechToTextModel).toMatchObject({
      label: 'Speech to Text Model',
      description: 'Transcribes audio input into text'
    })
    expect(settings.tools.voice.textToSpeechModel).toMatchObject({
      label: 'Text to Speech Model',
      description:
        'Generates spoken audio from text responses. gpt-4o-mini-tts supports tone/style instructions.'
    })
    expect(settings.tools.voice.textToSpeechVoice).toMatchObject({
      label: 'Text to Speech Voice',
      description: 'Voice persona for generated speech'
    })
    expect(settings.tools.voice.outputFormat).toMatchObject({
      label: 'Output Format',
      description: 'Audio format for generated speech'
    })
    expect(settings.tools.voice.speed).toMatchObject({
      label: 'Speed',
      description: 'Playback speed (0.25 – 4.0, default 1.0)'
    })
    expect(settings.tools.voice.instructions).toMatchObject({
      label: 'Voice Instructions',
      description:
        'Natural-language instructions to control tone, emotion and style (gpt-4o-mini-tts only)',
      placeholder:
        'e.g. Speak in a warm, friendly tone with a slight British accent'
    })
  })

  it('has the S3 tab keys', () => {
    expect(settings.tools.s3.region).toMatchObject({
      label: 'Region',
      description: 'The AWS region where your S3 bucket is hosted.'
    })
    expect(settings.tools.s3.bucket).toMatchObject({
      label: 'Bucket',
      description: 'The name of your S3 bucket for file uploads.',
      placeholder: 'Your S3 bucket'
    })
    expect(settings.tools.s3.accessKeyId).toMatchObject({
      label: 'Access Key ID',
      description: 'The IAM access key ID with S3 write permissions.'
    })
    expect(settings.tools.s3.secretAccessKey).toMatchObject({
      label: 'Secret Access Key',
      description:
        'The IAM secret access key paired with the access key ID above.'
    })
  })

  it('has the Data Controls tab keys', () => {
    expect(settings.dataControls.autoBackup).toMatchObject({
      label: 'Automatic Backups'
    })
    expect(settings.dataControls.recentBackups).toMatchObject({
      description_one: '{{count}} backup stored',
      description_other: '{{count}} backups stored'
    })
    expect(settings.dataControls.delete).toMatchObject({
      confirmPrompt: 'Type <strong>DELETE</strong> to confirm:',
      confirmButton: 'Delete Everything'
    })
  })

  it('has the Logger tab keys', () => {
    expect(settings.logger.filters.allScopes).toBe('All')
    expect(settings.logger.pagination).toMatchObject({
      range: '{{from}}–{{to}} of {{total}}',
      pageOf: 'Page {{page}} of {{totalPages}}'
    })
    expect(settings.logger.chart).toMatchObject({
      lines_one: 'line',
      lines_other: 'lines'
    })
    expect(Object.keys(settings.logger.levels)).toEqual([
      'error',
      'warn',
      'info',
      'debug'
    ])
  })

  it('has the MCP Servers tab keys', () => {
    expect(settings.mcpServers.serverCard).toMatchObject({
      toolCount_one: '{{count}} tool',
      toolCount_other: '{{count}} tools'
    })
    expect(settings.mcpServers.toast).toMatchObject({
      updated: '"{{name}}" updated — reconnecting…'
    })
  })

  it('has the memory section-group and shared keys', () => {
    expect(settings.memory.sectionGroups).toMatchObject({
      profile: 'You',
      topic: 'Topics',
      person: 'People'
    })
    expect(settings.memory.genericRetryHint).toBe('Try again')
    expect(settings.memory.restoreLabel).toBe('Restore')
    expect(settings.memory.disableLabel).toBe('Disable')
  })

  it('has the memory row and detail keys', () => {
    expect(settings.memory.row.noSummaryYet).toBe('No summary yet')
    expect(settings.memory.detail).toMatchObject({
      backButton: 'Memory',
      titlePlaceholder: 'Title',
      summaryLabel: 'Summary',
      detailsLabel: 'Details'
    })
  })

  it('has the memory composer keys with real pluralization', () => {
    expect(settings.memory.composer.toast).toMatchObject({
      updatedDescription_one: '{{count}} change applied',
      updatedDescription_other: '{{count}} changes applied'
    })
  })

  it('has the memory settings tab keys', () => {
    expect(settings.memory.settings.autoCapture.label).toBe('Capture memories')
    expect(settings.memory.settings.newMemoryDefaultKey).toBe('New memory')
    expect(settings.memory.settings.disabledHeading).toBe(
      'Disabled · {{count}}'
    )
  })
})

describe('settings namespace tools.voice.alert renders correctly via Trans', () => {
  it('keeps <strong>only support OpenAI</strong> literal, not a numbered placeholder', async () => {
    // Render the REAL exported component from voice.tsx (not a hand-copied
    // children array) — same rationale as s3.tsx's Trans render tests.
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { OpenAiOnlyNotice } =
      await import('@/components/settings/settings-form/voice')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(OpenAiOnlyNotice))
    )
    expect(html).toBe(
      'The Text-to-Speech and Speech-to-Text services <strong>only support OpenAI</strong>. Please make sure you have configured the OpenAI API setting correctly before using these features.'
    )
  })
})

describe('settings namespace tools.s3.alert.* renders correctly via Trans', () => {
  // Render the REAL exported components from s3.tsx (not a hand-copied
  // children array) — a formatter reflow of that file can insert/remove
  // `{' '}` around wrapped JSX text, which shifts these numbered
  // placeholders' positions. A hand-copied array wouldn't notice that
  // drift; rendering the actual source will.
  async function renderReal(Component: () => React.JSX.Element) {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    return renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(Component))
    )
  }

  it('encoding — one literal <strong>, no numbered placeholders', async () => {
    const { EncodingNotice } =
      await import('@/components/settings/settings-form/s3')
    const html = await renderReal(EncodingNotice)
    expect(html).toBe(
      'By default, Actovia encodes attachments as <strong>base64</strong> inline in the prompt. For large files or vision-heavy workflows, uploading to S3 and passing a URL is more efficient and reliable.'
    )
  })

  it('requirementsHeading — whole text wrapped in one literal <strong>', async () => {
    const { RequirementsHeading } =
      await import('@/components/settings/settings-form/s3')
    const html = await renderReal(RequirementsHeading)
    expect(html).toBe('<strong>Requirements before configuring:</strong>')
  })

  it('publicReadAccess — <strong> plus two <code>, correct positions', async () => {
    const { PublicReadAccessNotice } =
      await import('@/components/settings/settings-form/s3')
    const html = await renderReal(PublicReadAccessNotice)
    expect(html).toBe(
      '<strong>Public read access</strong> — AWS blocks public access by default. You must disable &quot;Block all public access&quot; on the bucket and attach a bucket policy granting <code>s3:GetObject</code> to <code>*</code>, so the AI provider can fetch the URL without credentials.'
    )
  })

  it('cors — <strong> plus two <code>, correct positions', async () => {
    const { CorsNotice } =
      await import('@/components/settings/settings-form/s3')
    const html = await renderReal(CorsNotice)
    expect(html).toBe(
      '<strong>CORS</strong> — Add a CORS rule allowing <code>PUT</code> from <code>*</code> (or your app origin) so Actovia can upload directly from the desktop.'
    )
  })

  it('iamCredentials — <strong> plus two <code>, correct positions', async () => {
    const { IamCredentialsNotice } =
      await import('@/components/settings/settings-form/s3')
    const html = await renderReal(IamCredentialsNotice)
    expect(html).toBe(
      '<strong>IAM credentials</strong> — The Access Key ID / Secret Access Key must belong to an IAM user or role with at least <code>s3:PutObject</code> and <code>s3:PutObjectAcl</code> permissions on the configured bucket.'
    )
  })

  it('objectAcl — <strong>, one <code>, one <em>, correct positions', async () => {
    const { ObjectAclNotice } =
      await import('@/components/settings/settings-form/s3')
    const html = await renderReal(ObjectAclNotice)
    expect(html).toBe(
      '<strong>Object ACL</strong> — Each uploaded object is set to <code>public-read</code>. Your bucket must not have ACLs disabled (i.e., Object Ownership must be set to <em>ACLs enabled / Bucket owner preferred</em>).'
    )
  })
})

describe('settings namespace mcpServers.intro renders correctly via Trans', () => {
  it('intro — <a> link at index 2, correct position', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { McpIntroNotice } =
      await import('@/components/settings/settings-form/mcp-servers')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(McpIntroNotice))
    )
    expect(html).toBe(
      'Register <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" class="font-semibold underline">MCP</a> servers (local or remote), then toggle the switch to enable their tools in chat.'
    )
  })
})

describe('settings namespace Phase 5 additions (en)', () => {
  it('has the skillsMarket keys (skills.sh market)', () => {
    expect(settings.skillsMarket.searchPlaceholder).toBe(
      'Search skills by name or owner'
    )
    expect(settings.skillsMarket.views).toMatchObject({
      trending: 'Trending (24h)',
      hot: 'Hot',
      allTime: 'All time'
    })
    expect(settings.skillsMarket.tabs).toMatchObject({
      discover: 'Discover',
      installed: 'Installed'
    })
    expect(settings.skillsMarket.browse.resultCount_one).toBe(
      '{{count}} result'
    )
    expect(settings.skillsMarket.browse.resultCount_other).toBe(
      '{{count}} results'
    )
    expect(settings.skillsMarket.card.installs).toBe(
      '<n>{{formatted}}</n> installs'
    )
    expect(settings.skillsMarket.detail.audit.summary).toBe(
      '{{passed}} of {{total}} checks passed'
    )
    expect(settings.skillsMarket.detail.cli.title).toBe(
      'Install from the terminal'
    )
    expect(settings.skillsMarket.toast.installedTitle).toBe(
      '“{{name}}” installed'
    )
    // Named (not positional) placeholders — see the render tests below.
    expect(settings.skillsMarket.sourceNotice).toContain(
      '<registry>skills.sh</registry>'
    )
    expect(settings.skillsMarket.cli.title).toContain(
      '<cli>the Actovia CLI</cli>'
    )
  })

  it('has the new top-level toast.* keys (useSettings / useSettingsAutosave)', () => {
    expect(settings.toast).toMatchObject({
      saveFailed: 'Failed to save settings',
      autoSaved: 'Auto saved',
      notSaved: 'Not saved'
    })
  })

  it('has the dataControls export/import/delete toast keys (useDbIo)', () => {
    expect(settings.dataControls.export).toMatchObject({
      successToast: 'Data exported successfully',
      errorToast: 'Export failed',
      errorFallback: 'Failed to export data.'
    })
    expect(settings.dataControls.import).toMatchObject({
      successToast: 'Data imported successfully',
      errorToast: 'Import failed',
      errorFallback: 'Failed to import data.'
    })
    expect(settings.dataControls.delete).toMatchObject({
      successToast: 'All data deleted',
      errorToast: 'Delete failed',
      errorFallback: 'Failed to delete data.'
    })
  })
})

describe('skillsMarket <Trans> notices render the real components', () => {
  async function renderReal(Component: () => React.JSX.Element) {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    return renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(Component))
    )
  }

  it('sourceNotice — the <registry> component becomes the skills.sh anchor (not <link>, an HTML void element the parser would close early)', async () => {
    const { SkillsSourceNoticeText } =
      await import('@/components/skills-market/source-notice')
    const html = await renderReal(SkillsSourceNoticeText)
    expect(html).toBe(
      'Skills come from <a href="https://www.skills.sh" target="_blank" rel="noopener noreferrer" class="text-foreground underline underline-offset-2">skills.sh</a>, the open Agent Skills registry. Each one carries independent security audits — read them before you install.'
    )
  })

  it('card.installs — <n> wraps the number, so it can be coloured apart from the word', async () => {
    const { Installs } = await import('@/components/skills-market/skill-row')
    const { createElement } = await import('react')
    const html = await renderReal(() =>
      createElement(Installs, { count: 3_500_000, emphasis: true })
    )
    expect(html).toBe(
      '<span class="text-muted-foreground tabular-nums"><span class="text-foreground">3.5M</span> installs</span>'
    )
  })

  it('cli.title — <cli> is the repo link (the commands are not copy: they live in CliQuickStart)', async () => {
    const { CliTitle } = await import('@/components/skills-market/cli-notice')
    const { ACTOVIA_CLI_REPO } =
      await import('@actovia/shared/constants/external-urls')
    const html = await renderReal(CliTitle)
    expect(html).toBe(
      `Prefer the terminal? Use <a href="${ACTOVIA_CLI_REPO}" target="_blank" rel="noopener noreferrer" class="text-foreground underline underline-offset-2">the Actovia CLI</a>`
    )
  })
})

describe('chatAudit (Settings → Developer, DuckDB) keys', () => {
  it('has the nav title and the page copy', () => {
    expect(settings.nav.chatAudit.title).toBe('Chat Audit')
    expect(settings.chatAudit.snapshot.build).toBe('Build snapshot')
    expect(settings.chatAudit.snapshot.builtAt).toBe('Built {{when}}')
    expect(settings.chatAudit.results.rowCount_one).toBe('{{count}} row')
    expect(settings.chatAudit.results.rowCount_other).toBe('{{count}} rows')
    expect(settings.chatAudit.results.duration).toBe('{{ms}} ms')
    expect(settings.chatAudit.presets.costByModel).toBe(
      'Tokens & cost by model'
    )
  })
})

describe('devices.pairing.steps.navigate renders correctly via Trans', () => {
  // Render the REAL exported component from devices-pairing.tsx, in every locale: the
  // menu path is the part of the pairing steps people hunt for, and it is only
  // bold if each catalog kept the literal <strong> tag.
  const LOCALES = [
    'en',
    'de',
    'es',
    'fr',
    'it',
    'ja',
    'ko',
    'pt-BR',
    'zh-Hant-HK',
    'zh-Hant-TW'
  ]

  async function renderStep(locale: string): Promise<string> {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { PairingNavigateStep } =
      await import('@/components/settings/settings-form/devices-pairing')
    const catalog = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '..',
          'packages',
          'shared',
          'src',
          'i18n',
          'locales',
          locale,
          'settings.json'
        ),
        'utf8'
      )
    )

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: locale,
      resources: { [locale]: { settings: catalog } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })
    return renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(PairingNavigateStep)
      )
    )
  }

  it('en — the menu path is a literal <strong>', async () => {
    expect(await renderStep('en')).toBe(
      'Go to <strong>Settings → Pair with computer</strong>'
    )
  })

  it.each(LOCALES)('%s — keeps exactly one <strong> run', async (locale) => {
    const html = await renderStep(locale)
    expect(html.match(/<strong>[^<]+<\/strong>/g)).toHaveLength(1)
    expect(html).not.toContain('&lt;')
  })
})
