import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Cancel01Icon, StarIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LazyLoadImage } from '@/components/markdown/lazy-load-image'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { FocusedPlaceContext } from './day-layer'
import { MapSurface } from './map-surface'
import { PlaceDetail } from './place-detail'
import {
  buildPlacePhotoUrl,
  type ItineraryPlace,
  type MapItineraryDetails
} from './types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  toolResult: MapItineraryDetails
  apiKey: string
  colorScheme: 'LIGHT' | 'DARK'
  /** The day the card in the transcript is on — full screen opens on it. */
  dayIdx: number
}

/**
 * The itinerary over the whole window, after ChatGPT's map view (ISSUE-295):
 * the map with Google's zoom buttons, and a column on the right listing the
 * day's places — a photo, the name, rating and kind — that opens on a place
 * in the same column. Its own map instance (one more Maps JS load per open,
 * never one per render), mounted only while open.
 */
export function ItineraryFullscreen({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="no-drag top-0 left-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none p-0 ring-0 sm:max-w-none"
      >
        <FullscreenBody {...rest} />
      </DialogContent>
    </Dialog>
  )
}

function FullscreenBody({
  toolResult,
  apiKey,
  colorScheme,
  dayIdx
}: Omit<Props, 'open' | 'onOpenChange'>) {
  const { t } = useTranslation('chat')
  const [activeDayIdx, setActiveDayIdx] = useState(dayIdx)
  // The list first; a place opens in the column.
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const day = toolResult.days[activeDayIdx] ?? toolResult.days[0]
  const total = day?.places.length ?? 0

  const onMarkerClick = useCallback((i: number) => setFocusedIdx(i), [])
  const onPrev = useCallback(
    () =>
      setFocusedIdx((i) =>
        total === 0 ? null : ((i ?? 0) - 1 + total) % total
      ),
    [total]
  )
  const onNext = useCallback(
    () => setFocusedIdx((i) => (total === 0 ? null : ((i ?? -1) + 1) % total)),
    [total]
  )

  if (!day) return null
  const focused = focusedIdx == null ? null : day.places[focusedIdx]

  return (
    <>
      <div className="relative min-w-0 flex-1">
        <FocusedPlaceContext.Provider value={focusedIdx}>
          <MapSurface
            apiKey={apiKey}
            colorScheme={colorScheme}
            places={day.places}
            onMarkerClick={onMarkerClick}
            fullscreen
          />
        </FocusedPlaceContext.Provider>
      </div>

      <aside className="bg-background border-border/60 flex w-96 shrink-0 flex-col border-l">
        <header className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium">
              {toolResult.title ?? day.title ?? day.label}
            </DialogTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('mapItineraryCard.placeCount', { count: total })}
            </p>
          </div>
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('mapItineraryCard.closeFullscreen')}
              />
            }
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          </DialogClose>
        </header>

        {toolResult.days.length > 1 && (
          <Tabs
            value={String(activeDayIdx)}
            onValueChange={(v) => {
              setActiveDayIdx(Number(v))
              setFocusedIdx(null)
            }}
            className="shrink-0 overflow-x-auto px-2"
          >
            <TabsList
              variant="line"
              aria-label={t('mapItineraryCard.tabsAriaLabel')}
            >
              {toolResult.days.map((d, i) => (
                <TabsTrigger
                  key={d.label}
                  value={String(i)}
                  className="text-xs"
                >
                  {d.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <div className="border-border/60 min-h-0 flex-1 border-t">
          {focused && focusedIdx != null ? (
            <PlaceDetail
              layout="panel"
              place={focused}
              dayLabel={day.label}
              index={focusedIdx}
              total={total}
              onPrev={onPrev}
              onNext={onNext}
              onClose={() => setFocusedIdx(null)}
            />
          ) : (
            <ol className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
              {day.places.map((place, i) => (
                <li key={`${place.lat}-${place.lng}-${i}`}>
                  <PlaceRow
                    place={place}
                    index={i}
                    onOpen={() => setFocusedIdx(i)}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  )
}

/** One place in the column: its first photo (or its number), the name, and
 *  rating · kind · time on one line. */
function PlaceRow({
  place,
  index,
  onOpen
}: {
  place: ItineraryPlace
  index: number
  onOpen: () => void
}) {
  const photo = useMemo(
    () => buildPlacePhotoUrl(place.photoNames?.[0], 240),
    [place.photoNames]
  )
  const meta = [place.type, place.timeLabel].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={TEST_IDS.mapItinerary.placeRow}
      className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors outline-none focus-visible:ring-3"
    >
      <div className="bg-muted text-muted-foreground relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-medium">
        {photo ? (
          <LazyLoadImage src={photo} alt="" className="size-full" />
        ) : (
          index + 1
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-sm font-medium">
          <span className="text-muted-foreground mr-1.5 tabular-nums">
            {index + 1}
          </span>
          {place.name}
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-xs">
          {place.rating !== undefined && (
            <span className="flex shrink-0 items-center gap-0.5">
              <HugeiconsIcon
                icon={StarIcon}
                size={11}
                className="fill-warning text-warning"
              />
              <span className="text-foreground">{place.rating.toFixed(1)}</span>
              {meta && <span aria-hidden>·</span>}
            </span>
          )}
          {meta && <span className="truncate">{meta}</span>}
        </div>
      </div>
    </button>
  )
}
