/**
 * Stable, semantic test ids ("checkpoints") for key interactive elements.
 *
 * Single source of truth: components apply these via `data-testid={TEST_IDS.…}`
 * and Playwright tests reference the same constants via `getByTestId(...)`.
 * The value mirrors the object path (camelCase → kebab-case), e.g.
 * `TEST_IDS.lock.pinInput` → `'lock.pin-input'`. Ids are a durable contract:
 * once added, do not rename or regenerate them. The linkage test
 * (`test-ids.linkage.test.ts`) enforces that every id is applied in source and
 * referenced by a test.
 */
export const TEST_IDS = {
  lock: {
    pinInput: 'lock.pin-input',
    touchIdButton: 'lock.touch-id-button',
    enablePinInput: 'lock.enable-pin-input',
    confirmPinInput: 'lock.confirm-pin-input',
    idleSelect: 'lock.idle-select',
    removeButton: 'lock.remove-button',
    removePinInput: 'lock.remove-pin-input'
  },
  gallery: {
    thumbnail: 'gallery.thumbnail',
    lightboxClose: 'gallery.lightbox-close',
    lightboxPrev: 'gallery.lightbox-prev',
    lightboxNext: 'gallery.lightbox-next',
    lightboxDot: 'gallery.lightbox-dot',
    /** In the lightbox's toolbar: saves the image on the stage. */
    lightboxDownload: 'gallery.lightbox-download'
  },
  /**
   * An image in the transcript (sent, generated, a search result's): the
   * download button at its corner on hover/focus, and the one in the zoomed
   * view's toolbar.
   */
  attachment: {
    download: 'attachment.download',
    zoomDownload: 'attachment.zoom-download'
  },
  video: {
    card: 'video.card'
  },
  schedule: {
    tab: 'schedule.tab',
    createButton: 'schedule.create-button',
    taskCard: 'schedule.task-card',
    cancelButton: 'schedule.cancel-button'
  },
  skillsMarket: {
    searchInput: 'skills-market.search-input',
    viewToggle: 'skills-market.view-toggle',
    discoverTab: 'skills-market.discover-tab',
    installedTab: 'skills-market.installed-tab',
    row: 'skills-market.row',
    expandGroupButton: 'skills-market.expand-group-button',
    curatedOwnerButton: 'skills-market.curated-owner-button',
    loadMoreButton: 'skills-market.load-more-button',
    backButton: 'skills-market.back-button',
    installButton: 'skills-market.install-button',
    uninstallButton: 'skills-market.uninstall-button',
    confirmUninstallButton: 'skills-market.confirm-uninstall-button',
    activeSwitch: 'skills-market.active-switch',
    auditPanel: 'skills-market.audit-panel',
    cliCommand: 'skills-market.cli-command',
    copyCommandButton: 'skills-market.copy-command-button'
  },
  chatAudit: {
    buildButton: 'chat-audit.build-button',
    openFolderButton: 'chat-audit.open-folder-button',
    presetButton: 'chat-audit.preset-button',
    sqlInput: 'chat-audit.sql-input',
    runButton: 'chat-audit.run-button',
    resultsTable: 'chat-audit.results-table',
    downloadCsvButton: 'chat-audit.download-csv-button'
  },
  devices: {
    pairButton: 'devices.pair-button',
    qrCode: 'devices.qr-code',
    copyLinkButton: 'devices.copy-link-button',
    cancelPairingButton: 'devices.cancel-pairing-button',
    deviceRow: 'devices.device-row',
    revokeButton: 'devices.revoke-button',
    resetButton: 'devices.reset-button'
  },
  knowledgeBase: {
    testConnectionButton: 'knowledge-base.test-connection-button',
    reindexButton: 'knowledge-base.reindex-button',
    addButton: 'knowledge-base.add-button',
    docDialog: 'knowledge-base.doc-dialog',
    docTitleInput: 'knowledge-base.doc-title-input',
    docContentInput: 'knowledge-base.doc-content-input',
    docSaveButton: 'knowledge-base.doc-save-button'
  },
  discover: {
    enableToggle: 'discover.enable-toggle',
    section: 'discover.section'
  },
  computerUse: {
    enableToggle: 'computer-use.enable-toggle',
    allowlistInput: 'computer-use.allowlist-input',
    stopButton: 'computer-use.stop-button',
    continueButton: 'computer-use.continue-button'
  },
  logger: {
    scopeSelect: 'logger.scope-select',
    traceBadge: 'logger.trace-badge',
    traceFilterChip: 'logger.trace-filter-chip',
    searchInput: 'logger.search-input',
    liveToggle: 'logger.live-toggle',
    chart: 'logger.chart',
    chartBar: 'logger.chart-bar',
    levelToggle: 'logger.level-toggle',
    windowChip: 'logger.window-chip',
    row: 'logger.row',
    detailSheet: 'logger.detail-sheet',
    detailPrev: 'logger.detail-prev',
    detailNext: 'logger.detail-next',
    linesAround: 'logger.lines-around',
    copyForAi: 'logger.copy-for-ai'
  },
  chatToc: {
    rail: 'chat-toc.rail',
    entry: 'chat-toc.entry'
  },
  settings: {
    themeMode: 'settings.theme-mode',
    colorTone: 'settings.color-tone',
    languageSelect: 'settings.language-select'
  },
  chatLayout: {
    workspaceSwitcher: 'chat-layout.workspace-switcher',
    searchButton: 'chat-layout.search-button',
    newChat: 'chat-layout.new-chat',
    account: 'chat-layout.account',
    accountSettings: 'chat-layout.account-settings',
    /** One per chat in the sidebar: the "…" that opens its menu. */
    historyItemMenu: 'chat-layout.history-item-menu',
    /** In that menu: puts the conversation's id on the clipboard. */
    copyChatId: 'chat-layout.copy-chat-id'
  },
  philharmonic: {
    newGroup: 'philharmonic.new-group',
    membersToggle: 'philharmonic.members-toggle',
    /** Under a PM message: opens the round's decision process. */
    decisionToggle: 'philharmonic.decision-toggle'
  },
  providerModels: {
    refreshButton: 'provider-models.refresh-button',
    modelSelect: 'provider-models.model-select',
    /** The refresh refused: a saved key cannot go to an unsaved base URL. */
    reenterError: 'provider-models.reenter-error'
  },
  /**
   * Stored secrets in Settings. Every key input carries `data-field="<settings
   * path>"` and, while it shows a saved key's mask, `data-masked="true"`.
   */
  secrets: {
    keyInput: 'secrets.key-input',
    /** Under a key input whose saved key was cleared or can't be read. */
    reenterPrompt: 'secrets.reenter-prompt',
    /** Under a base-URL field whose key is saved: changing it clears the key. */
    destinationHint: 'secrets.destination-hint',
    /** Settings → General: the keychain is unavailable. */
    encryptionNotice: 'secrets.encryption-notice',
    /** Settings → General: the keys that need entering again. */
    reentryNotice: 'secrets.reentry-notice'
  },
  /** Settings → MCP Servers, the server form. */
  mcpServers: {
    /** The stdio server's environment variables (JSON). */
    envInput: 'mcp-servers.env-input',
    /** A field the server refused (`data-field`: url, args, env, headers…). */
    fieldError: 'mcp-servers.field-error',
    /** Shown while a stdio server's args hold a secret (`ps` shows args). */
    argsSecretNotice: 'mcp-servers.args-secret-notice'
  },
  chat: {
    /** One per assistant message (= one per run). */
    messageAction: 'chat.message-action',
    /**
     * A file a turn wrote or edited in the chat's workspace: its card, the
     * card's actions, the Quick look dialog, and a path in an answer that
     * names such a file (a link that opens it).
     */
    workspaceFile: {
      card: 'chat.workspace-file.card',
      open: 'chat.workspace-file.open',
      reveal: 'chat.workspace-file.reveal',
      quickLook: 'chat.workspace-file.quick-look',
      preview: 'chat.workspace-file.preview',
      pathLink: 'chat.workspace-file.path-link'
    },
    /** In that bar: asks the last question again, as a comparison. */
    regenerate: 'chat.regenerate',
    /**
     * At the foot of a run whose tool call waits for the user's approval (a
     * secret outside Actovia): the card, its two answers, and the settled
     * state (`data-state`: allowed | denied | timed_out | stopped | expired).
     */
    approval: {
      card: 'chat.approval.card',
      allow: 'chat.approval.allow',
      deny: 'chat.approval.deny',
      state: 'chat.approval.state'
    },
    /** Over text selected in a message: asks about it (see composer.quote). */
    ask: {
      button: 'chat.ask.button'
    },
    /**
     * In a user bubble whose message was asked from the phone's Health
     * workspace: the chips of the numbers it carried, and what they open.
     */
    health: {
      trigger: 'chat.health.trigger',
      details: 'chat.health.details'
    },
    /**
     * A regenerate group: "Use this one" over each of the two answers (and
     * the tab of each, in a narrow window), the link to the answer not kept,
     * and "Use this instead" in the dialog it opens.
     */
    compare: {
      useThis: 'chat.compare.use-this',
      tab: 'chat.compare.tab',
      otherVersionLink: 'chat.compare.other-version-link',
      useInstead: 'chat.compare.use-instead'
    },
    /** At the foot of a run that changed memory (the `update_memory` tool). */
    memoryStrip: {
      root: 'chat.memory-strip.root',
      toggle: 'chat.memory-strip.toggle',
      undo: 'chat.memory-strip.undo'
    },
    /** At the foot of a run that used memories: the line and its popover. */
    usedMemories: {
      trigger: 'chat.used-memories.trigger',
      popover: 'chat.used-memories.popover',
      /** One per entry in the popover. */
      wrong: 'chat.used-memories.wrong',
      openSettings: 'chat.used-memories.open-settings'
    },
    /** A remote markdown image that has not been loaded yet (see remote-image.tsx). */
    remoteImage: {
      placeholder: 'chat.remote-image.placeholder',
      loadButton: 'chat.remote-image.load-button'
    },
    /** The phase-2 blocks drawn in a reply: steps, the stock chart, the entity link and its panel (chat/interactive/). */
    richBlocks: {
      steps: 'chat.rich-blocks.steps',
      step: 'chat.rich-blocks.step',
      stepImage: 'chat.rich-blocks.step-image',
      stock: 'chat.rich-blocks.stock',
      stockFrame: 'chat.rich-blocks.stock-frame',
      stockFallback: 'chat.rich-blocks.stock-fallback',
      entityLink: 'chat.rich-blocks.entity-link',
      entityPanel: 'chat.rich-blocks.entity-panel'
    },
    /** The chat header (chat/header/): the history arrows, the title group, the panel toggle. */
    header: {
      back: 'chat.header.back',
      forward: 'chat.header.forward',
      title: 'chat.header.title',
      modelChip: 'chat.header.model-chip',
      /** One per model in the chip's list (`data-model` holds the id). */
      modelOption: 'chat.header.model-option',
      menu: 'chat.header.menu',
      panelToggle: 'chat.header.panel-toggle'
    },
    /** The header's files / tools / sources panel (chat/panel/): its root, a section tab, a row, the empty line. */
    panel: {
      root: 'chat.panel.root',
      tab: 'chat.panel.tab',
      item: 'chat.panel.item',
      empty: 'chat.panel.empty'
    }
  },
  composer: {
    /** The text selected in a message, over the field, and its ✕. */
    quote: 'composer.quote',
    quoteRemove: 'composer.quote-remove',
    reasoningEffortItem: 'composer.reasoning-effort-item',
    reasoningEffortLevel: 'composer.reasoning-effort-level',
    textarea: 'composer.textarea'
  },
  findInPage: {
    input: 'find-in-page.input',
    previousButton: 'find-in-page.previous-button',
    nextButton: 'find-in-page.next-button',
    closeButton: 'find-in-page.close-button'
  },
  weatherCard: {
    /** The Details / Less toggle at the card's foot. */
    details: 'weather-card.details',
    /** The readings grid, visible only once the card is open. */
    readings: 'weather-card.readings'
  },
  /** The `image_generation` tool's card in a chat. */
  imageGeneration: {
    /** One frame (its `data-state`: generating / complete / error). */
    card: 'image-generation.card'
  },
  /** Settings → Memory. */
  memorySettings: {
    /** Retry on the stored-memories list after its read failed. */
    retry: 'memory-settings.retry'
  },
  /** Settings → Built-in Tools. Each carries `data-tool="<wire name>"`. */
  tools: {
    /** A tool's on/off switch. */
    toggle: 'tools.toggle',
    /** The Configure disclosure of a tool that has a panel. */
    configure: 'tools.configure',
    /** The panel itself (its `data-open` says whether it is open). */
    panel: 'tools.panel'
  }
} as const

export interface FlatTestId {
  /** Source token, e.g. "TEST_IDS.lock.pinInput". */
  accessor: string
  /** Attribute value, e.g. "lock.pin-input". */
  value: string
}

/** Flatten the nested registry into accessor/value pairs for tooling. */
export function flattenTestIds(
  node: Record<string, unknown> = TEST_IDS,
  prefix = 'TEST_IDS'
): FlatTestId[] {
  const out: FlatTestId[] = []
  for (const [key, val] of Object.entries(node)) {
    const accessor = `${prefix}.${key}`
    if (typeof val === 'string') {
      out.push({ accessor, value: val })
    } else if (val && typeof val === 'object') {
      out.push(...flattenTestIds(val as Record<string, unknown>, accessor))
    }
  }
  return out
}
