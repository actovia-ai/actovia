import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  Globe02Icon,
  StarIcon,
  Cancel01Icon,
  Location01Icon,
  CallIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LazyLoadImage } from '@/components/markdown/lazy-load-image'
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem
} from '@/components/ui/carousel'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { buildPlacePhotoUrl, type ItineraryPlace } from './types'

type PlaceDetailProps = {
  place: ItineraryPlace
  dayLabel: string
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  /** `overlay` floats over the map in the transcript's card; `panel` fills
   *  the full-screen view's side column, where closing goes back to the list. */
  layout?: 'overlay' | 'panel'
}

function formatReviewCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return n.toString()
}

type Tab = 'overview' | 'reviews' | 'hours'

/** A place of the itinerary: hero photo (carousel if Places returned more),
 *  day/time, name, rating, contact info, notes, reviews, hours, and prev/next
 *  through the day. Floats over the map's right side on a popover surface
 *  (`overlay`) — clear of the map's foot, where Google's attribution must stay
 *  visible — or fills the full-screen view's column (`panel`). */
export function PlaceDetail({
  place,
  dayLabel,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  layout = 'overlay'
}: PlaceDetailProps) {
  const { t } = useTranslation('chat')
  const [tab, setTab] = useState<Tab>('overview')
  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [photoIdx, setPhotoIdx] = useState(0)

  const photoUrls = useMemo(() => {
    if (!place.photoNames?.length) return []
    return place.photoNames
      .map((n) => buildPlacePhotoUrl(n, 800))
      .filter((u): u is string => !!u)
  }, [place.photoNames])

  // Track the carousel's current slide index for the "1/N" counter.
  useEffect(() => {
    if (!carouselApi) return
    setPhotoIdx(carouselApi.selectedScrollSnap())
    const onSelect = () => setPhotoIdx(carouselApi.selectedScrollSnap())
    carouselApi.on('select', onSelect)
    return () => {
      carouselApi.off('select', onSelect)
    }
  }, [carouselApi])

  // Reset internal state when the place changes via prev/next, so a stale
  // photo index or sub-tab doesn't leak into the new place.
  const placeKey = `${place.lat}-${place.lng}-${place.name}`
  const [lastKey, setLastKey] = useState(placeKey)
  if (lastKey !== placeKey) {
    setLastKey(placeKey)
    setTab('overview')
    setPhotoIdx(0)
    // Snap the carousel back to the first slide instantly (no animation,
    // since the place itself just changed underneath).
    carouselApi?.scrollTo(0, true)
  }

  const hasReviews = (place.reviews?.length ?? 0) > 0
  const hasHours = (place.openingHours?.length ?? 0) > 0

  return (
    <div
      className={cn(
        'bg-popover text-popover-foreground flex flex-col overflow-hidden',
        layout === 'overlay'
          ? 'ring-foreground/10 absolute top-3 right-3 bottom-8 z-10 w-80 rounded-2xl shadow-lg ring-1'
          : 'size-full'
      )}
    >
      {/* Hero — shadcn Carousel cycling through Places photos when we have
          more than one; falls back to a tinted gradient when we have none. */}
      <div
        className={cn(
          'bg-muted relative shrink-0 overflow-hidden',
          layout === 'overlay' ? 'h-36' : 'h-52'
        )}
      >
        {photoUrls.length > 0 ? (
          <Carousel
            setApi={setCarouselApi}
            opts={{ loop: photoUrls.length > 1 }}
            className="size-full"
          >
            <CarouselContent className="ml-0">
              {photoUrls.map((url) => (
                <CarouselItem key={url} className="pl-0">
                  <LazyLoadImage
                    src={url}
                    alt={place.name}
                    className={cn(
                      'w-full',
                      layout === 'overlay' ? 'h-36' : 'h-52'
                    )}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            {photoUrls.length > 1 && (
              // Dot indicators — clickable, active dot widens to a pill.
              // Navigation: swipe / drag / arrow keys / clicking dots.
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/45 px-2 py-1 backdrop-blur-sm">
                {photoUrls.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    aria-label={t('placeDetail.goToPhotoAriaLabel', {
                      index: i + 1
                    })}
                    aria-current={i === photoIdx ? 'true' : undefined}
                    onClick={() => carouselApi?.scrollTo(i)}
                    className={cn(
                      'h-1.5 rounded-full bg-white transition-[width,opacity]',
                      i === photoIdx
                        ? 'w-4 opacity-100'
                        : 'w-1.5 opacity-50 hover:opacity-80'
                    )}
                  />
                ))}
              </div>
            )}
          </Carousel>
        ) : (
          <div className="from-primary/20 to-muted size-full bg-gradient-to-br" />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={
            layout === 'overlay'
              ? t('placeDetail.closeAriaLabel')
              : t('placeDetail.backToList')
          }
          className={cn(
            'bg-background/80 text-foreground hover:bg-background absolute top-2 z-10 flex size-7 items-center justify-center rounded-full shadow-sm backdrop-blur transition-colors',
            layout === 'overlay' ? 'right-2' : 'left-2'
          )}
        >
          <HugeiconsIcon
            icon={layout === 'overlay' ? Cancel01Icon : ArrowLeft01Icon}
            size={14}
          />
        </button>
      </div>

      {/* Header strip — day · time, name, rating + type chip */}
      <div className="space-y-1.5 px-4 pt-3 pb-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span>{dayLabel}</span>
          {place.timeLabel && (
            <>
              <span aria-hidden>·</span>
              <span>{place.timeLabel}</span>
            </>
          )}
          {place.openNow !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span
                className={cn(place.openNow && 'text-foreground font-medium')}
              >
                {place.openNow
                  ? t('placeDetail.open')
                  : t('placeDetail.closed')}
              </span>
            </>
          )}
        </div>
        <h3 className="text-foreground text-base leading-tight font-semibold">
          {place.name}
        </h3>
        {(place.rating !== undefined || place.type) && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {place.rating !== undefined && (
              <span className="flex items-center gap-1">
                <span className="text-foreground font-medium">
                  {place.rating.toFixed(1)}
                </span>
                <HugeiconsIcon
                  icon={StarIcon}

                  size={11}
                  className="fill-warning text-warning"
                />
                {place.reviewCount !== undefined && (
                  <span>({formatReviewCount(place.reviewCount)})</span>
                )}
              </span>
            )}
            {place.rating !== undefined && place.type && (
              <span aria-hidden>·</span>
            )}
            {place.type && <span>{place.type}</span>}
          </div>
        )}
      </div>

      {/* Tabs — only the Reviews and Hours tabs are gated on whether we have
          that data; Overview is always present. */}
      {(hasReviews || hasHours) && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="shrink-0 px-2"
        >
          <TabsList
            variant="line"
            aria-label={t('placeDetail.tabsAriaLabel')}
            className="w-full"
          >
            <TabsTrigger value="overview" className="text-xs">
              {t('placeDetail.tabOverview')}
            </TabsTrigger>
            {hasReviews && (
              <TabsTrigger value="reviews" className="text-xs">
                {t('placeDetail.tabReviews')}
              </TabsTrigger>
            )}
            {hasHours && (
              <TabsTrigger value="hours" className="text-xs">
                {t('placeDetail.tabHours')}
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      )}

      {/* Body */}
      <div className="border-border/60 flex-1 space-y-3 overflow-x-hidden overflow-y-auto border-t px-4 py-3">
        {tab === 'overview' && (
          <>
            {place.note && (
              <div className="bg-muted/60 rounded-lg p-2.5">
                <div className="text-muted-foreground text-2xs mb-1 tracking-widest uppercase">
                  {t('placeDetail.notes')}
                </div>
                <p className="text-foreground text-xs leading-relaxed">
                  {place.note}
                </p>
              </div>
            )}
            <ContactRow
              icon={
                <HugeiconsIcon
                  icon={Location01Icon}

                  size={12}
                />
              }
              text={place.address}
              href={
                place.googleMapsUri ??
                `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
              }
            />
            <ContactRow
              icon={<HugeiconsIcon icon={CallIcon} size={12} />}
              text={place.phone}
              href={
                place.phone
                  ? `tel:${place.phone.replace(/\s+/g, '')}`
                  : undefined
              }
            />
            <ContactRow
              icon={<HugeiconsIcon icon={Globe02Icon} size={12} />}
              text={place.websiteUri?.replace(/^https?:\/\//, '')}
              href={place.websiteUri}
              truncate
            />
          </>
        )}

        {tab === 'reviews' && hasReviews && (
          <div className="divide-border/60 -my-1 divide-y">
            {place.reviews!.map((r) => (
              <article
                key={`${r.author ?? ''}-${r.relativeTime ?? ''}`}
                className="py-2.5"
              >
                <div className="mb-1 flex items-center gap-2">
                  <ReviewAvatar src={r.authorPhotoUrl} name={r.author} />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-xs font-medium">
                      {r.author ?? t('placeDetail.anonymousReviewer')}
                    </div>
                    <div className="text-muted-foreground text-2xs flex items-center gap-1">
                      {r.rating !== undefined && (
                        <span className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, j) => (
                            <HugeiconsIcon
                              icon={StarIcon}

                              key={j}
                              size={9}
                              className={
                                j < (r.rating ?? 0)
                                  ? 'fill-warning text-warning'
                                  : 'text-muted-foreground/40'
                              }
                            />
                          ))}
                        </span>
                      )}
                      {r.relativeTime && <span>{r.relativeTime}</span>}
                    </div>
                  </div>
                </div>
                {r.text && (
                  <p className="text-muted-foreground line-clamp-4 text-xs leading-relaxed">
                    {r.text}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}

        {tab === 'hours' && hasHours && (
          <ul className="space-y-1 text-xs">
            {place.openingHours!.map((line) => {
              const sep = line.indexOf(': ')
              const day = sep >= 0 ? line.slice(0, sep) : line
              const time = sep >= 0 ? line.slice(sep + 2) : ''
              return (
                <li
                  key={line}
                  className="flex items-center justify-between gap-2 py-0.5"
                >
                  <span className="text-foreground font-medium">{day}</span>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <HugeiconsIcon
                      icon={Clock01Icon}

                      size={10}
                    />
                    {time}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Pagination — circles through the day's places without dismissing
          the card. */}
      <div className="border-border/60 flex items-center justify-between border-t px-2 py-1.5">
        <button
          type="button"
          onClick={onPrev}
          aria-label={t('placeDetail.previousAriaLabel')}
          className={cn(
            'hover:bg-muted text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors',
            total <= 1 && 'pointer-events-none opacity-30'
          )}
          disabled={total <= 1}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
        </button>
        <span className="text-muted-foreground text-2xs">
          {t('placeDetail.pagination', { index: index + 1, total })}
        </span>
        <button
          type="button"
          onClick={onNext}
          aria-label={t('placeDetail.nextAriaLabel')}
          className={cn(
            'hover:bg-muted text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors',
            total <= 1 && 'pointer-events-none opacity-30'
          )}
          disabled={total <= 1}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
    </div>
  )
}

/** Reviewer avatar. Google serves author photos from `lh3.googleusercontent.com`,
 *  which rejects a chunk of requests (403 / 429) when they carry a `Referer` it
 *  doesn't expect — so from the Electron renderer's origin many "crack" even
 *  though the same URL opens fine pasted into a browser tab.
 *  `referrerPolicy="no-referrer"` makes Google serve them; a genuinely dead URL
 *  still falls back to the initial. */
function ReviewAvatar({ src, name }: { src?: string; name?: string }) {
  const initial = (
    <div className="bg-muted text-muted-foreground text-2xs flex size-6 shrink-0 items-center justify-center rounded-full font-medium">
      {name?.charAt(0)?.toUpperCase() ?? '·'}
    </div>
  )
  if (!src) return initial
  return (
    <LazyLoadImage
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      fallback={initial}
      className="bg-muted size-6 shrink-0 rounded-full"
    />
  )
}

function ContactRow({
  icon,
  text,
  href,
  truncate
}: {
  icon: React.ReactNode
  text: string | undefined
  href?: string
  truncate?: boolean
}) {
  if (!text) return null
  const content = (
    <span className={cn('min-w-0 flex-1', truncate && 'truncate')}>{text}</span>
  )
  return (
    <div className="text-muted-foreground flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0">{icon}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          // A flex row itself: only then is the text a flex item with a
          // width to truncate against — as an inline link's child a long
          // website address ran on and scrolled the panel sideways.
          className="hover:text-foreground flex min-w-0 flex-1 transition-colors"
        >
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  )
}
