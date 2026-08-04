'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0)
  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
        <Image src={images[active] || '/placeholder.svg'} alt={name} fill className="object-cover" priority />
      </div>
      <div className="mt-3 flex gap-3">
        {images.map((src, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            aria-label={`View image ${i + 1}`}
            className={cn(
              'relative size-20 shrink-0 overflow-hidden rounded-xl border-2 transition-colors',
              i === active ? 'border-orange' : 'border-border hover:border-orange/40',
            )}
          >
            <Image src={src || '/placeholder.svg'} alt="" fill className="object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
