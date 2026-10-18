export const __hnCancelPendingIframeLoad = (iframe, pending) => {
    if (!pending) return false
    pending.cleanup()
    iframe.src = 'about:blank'
    pending.reject(new Error('HN_FOLIATE_LOAD_CANCELLED'))
    return true
}
export const __hnCreateRendererCancellation = () => {
    let reject
    const promise = new Promise((_, rejectFn) => { reject = rejectFn })
    promise.catch(() => undefined)
    return { promise, reject }
}
export const __hnRaceRendererLoad = (load, cancellation) =>
    cancellation ? Promise.race([load, cancellation.promise]) : load
export const __hnTrackRendererLoad = (renderer, section) => {
    if (!section?.load) return Promise.resolve(undefined)
    renderer.__hnTrackedSections.add(section)
    let raw
    try { raw = Promise.resolve(section.load()) }
    catch (error) { raw = Promise.reject(error) }
    renderer.__hnRawLoads.add(raw)
    raw.then(
        () => { if (renderer.__hnInvalidated) __hnCleanupSection(renderer, section) },
        () => undefined,
    ).finally(() => renderer.__hnRawLoads.delete(raw)).catch(() => undefined)
    return raw
}
export const __hnCleanupSection = (renderer, section) => {
    if (!section || renderer.__hnCleanedSections.has(section)) return
    renderer.__hnCleanedSections.add(section)
    section.unload?.()
}
export const __hnInvalidateRendererLoads = renderer => {
    if (renderer.__hnInvalidated) return false
    renderer.__hnInvalidated = true
    for (const section of renderer.__hnTrackedSections) {
        section.invalidate?.()
        __hnCleanupSection(renderer, section)
    }
    return true
}

const parseViewport = str => str
    ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
    ?.filter(x => x)
    ?.map(x => x.split('=').map(x => x.trim()))

const getViewport = (doc, viewport) => {
    // use `viewBox` for SVG
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement
            .getAttribute('viewBox')?.split(/\s/) ?? []
        return { width, height }
    }

    // get `viewport` `meta` element
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')
        ?.getAttribute('content'))
    if (meta) return Object.fromEntries(meta)

    // fallback to book's viewport
    if (typeof viewport === 'string') return parseViewport(viewport)
    if (viewport?.width && viewport.height) return viewport

    // if no viewport (possibly with image directly in spine), get image size
    const img = doc.querySelector('img')
    if (img) return { width: img.naturalWidth, height: img.naturalHeight }

    // just show *something*, i guess...
    console.warn(new Error('Missing viewport properties'))
    return { width: 1000, height: 2000 }
}

export class FixedLayout extends HTMLElement {
    static observedAttributes = ['zoom']
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => this.#render())
    #spreads
    #index = -1
    defaultViewport
    spread
    #portrait = false
    #left
    #right
    #center
    #side
    #zoom
    __hnPendingFrames = new Set()
    __hnCancelled = false
    __hnInvalidated = false
    __hnCancellation
    __hnRawLoads = new Set()
    __hnTrackedSections = new Set()
    __hnCleanedSections = new WeakSet()
    constructor() {
        super()

        const sheet = new CSSStyleSheet()
        this.#root.adoptedStyleSheets = [sheet]
        sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: auto;
        }`)

        this.#observer.observe(this)
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'zoom':
                this.#zoom = value !== 'fit-width' && value !== 'fit-page'
                    ? parseFloat(value) : value
                this.#render()
                break
        }
    }
    async #createFrame({ index, src: srcOption }) {
        const srcOptionIsString = typeof srcOption === 'string'
        const src = srcOptionIsString ? srcOption : srcOption?.src
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom
        const element = document.createElement('div')
        element.setAttribute('dir', 'ltr')
        const iframe = document.createElement('iframe')
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        const publicationCsp = this.getAttribute('data-foliate-publication-csp')
        if (publicationCsp) iframe.setAttribute('csp', publicationCsp)
        element.append(iframe)
        Object.assign(iframe.style, {
            border: '0',
            display: 'none',
            overflow: 'hidden',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        iframe.setAttribute('scrolling', 'no')
        iframe.setAttribute('part', 'filter')
        this.#root.append(element)
        if (!src) return { blank: true, element, iframe }
        return new Promise((resolve, reject) => {
            let settled = false
            const cleanup = () => {
                iframe.removeEventListener('load', onLoad)
                iframe.removeEventListener('error', onError)
                this.__hnPendingFrames.delete(cancel)
            }
            const cancel = () => {
                if (settled) return
                settled = true
                __hnCancelPendingIframeLoad(iframe, { cleanup, reject })
                element.remove()
            }
            const onLoad = () => {
                const doc = iframe.contentDocument
                this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
                const { width, height } = getViewport(doc, this.defaultViewport)
                if (settled) return
                settled = true
                cleanup()
                resolve({
                    element, iframe,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                })
            }
            const onError = () => cancel()
            this.__hnPendingFrames.add(cancel)
            iframe.addEventListener('load', onLoad, { once: true })
            iframe.addEventListener('error', onError, { once: true })
            iframe.src = src
        })
    }
    #render(side = this.#side) {
        if (!side) return
        const left = this.#left ?? {}
        const right = this.#center ?? this.#right ?? {}
        const target = side === 'left' ? left : right
        const { width, height } = this.getBoundingClientRect()
        const portrait = this.spread !== 'both' && this.spread !== 'portrait'
            && height > width
        this.#portrait = portrait
        const blankWidth = left.width ?? right.width ?? 0
        const blankHeight = left.height ?? right.height ?? 0

        const scale = typeof this.#zoom === 'number' && !isNaN(this.#zoom)
            ? this.#zoom
            : (this.#zoom === 'fit-width'
                ? (portrait || this.#center
                    ? width / (target.width ?? blankWidth)
                    : width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)))
                : (portrait || this.#center
                    ? Math.min(
                        width / (target.width ?? blankWidth),
                        height / (target.height ?? blankHeight))
                    : Math.min(
                        width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
                        height / Math.max(
                            left.height ?? blankHeight,
                            right.height ?? blankHeight)))
            ) || 1

        const transform = frame => {
            let { element, iframe, width, height, blank, onZoom } = frame
            if (!iframe) return
            if (onZoom) onZoom({ doc: frame.iframe.contentDocument, scale })
            const iframeScale = onZoom ? scale : 1
            Object.assign(iframe.style, {
                width: `${width * iframeScale}px`,
                height: `${height * iframeScale}px`,
                transform: onZoom ? 'none' : `scale(${scale})`,
                transformOrigin: 'top left',
                display: blank ? 'none' : 'block',
            })
            Object.assign(element.style, {
                width: `${(width ?? blankWidth) * scale}px`,
                height: `${(height ?? blankHeight) * scale}px`,
                overflow: 'hidden',
                display: 'block',
                flexShrink: '0',
                marginBlock: 'auto',
            })
            if (portrait && frame !== target) {
                element.style.display = 'none'
            }
        }
        if (this.#center) {
            transform(this.#center)
        } else {
            transform(left)
            transform(right)
        }
    }
    async #showSpread({ left, right, center, side }) {
        this.#root.replaceChildren()
        this.#left = null
        this.#right = null
        this.#center = null
        if (center) {
            this.#center = await this.#createFrame(center)
            this.#side = 'center'
            this.#render()
        } else {
            this.#left = await this.#createFrame(left)
            this.#right = await this.#createFrame(right)
            this.#side = this.#left.blank ? 'right'
                : this.#right.blank ? 'left' : side
            this.#render()
        }
    }
    #goLeft() {
        if (this.#center || this.#left?.blank) return
        if (this.#portrait && this.#left?.element?.style?.display === 'none') {
            this.#side = 'left'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    #goRight() {
        if (this.#center || this.#right?.blank) return
        if (this.#portrait && this.#right?.element?.style?.display === 'none') {
            this.#side = 'right'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    open(book) {
        this.__hnCancelled = false
        this.__hnInvalidated = false
        this.__hnCancellation = __hnCreateRendererCancellation()
        this.book = book
        const { rendition } = book
        this.spread = rendition?.spread
        this.defaultViewport = rendition?.viewport

        const rtl = book.dir === 'rtl'
        const ltr = !rtl
        this.rtl = rtl

        if (rendition?.spread === 'none')
            this.#spreads = book.sections.map(section => ({ center: section }))
        else this.#spreads = book.sections.reduce((arr, section, i) => {
            const last = arr[arr.length - 1]
            const { pageSpread } = section
            const newSpread = () => {
                const spread = {}
                arr.push(spread)
                return spread
            }
            if (pageSpread === 'center') {
                const spread = last.left || last.right ? newSpread() : last
                spread.center = section
            }
            else if (pageSpread === 'left') {
                const spread = last.center || last.left || ltr && i ? newSpread() : last
                spread.left = section
            }
            else if (pageSpread === 'right') {
                const spread = last.center || last.right || rtl && i ? newSpread() : last
                spread.right = section
            }
            else if (ltr) {
                if (last.center || last.right) newSpread().left = section
                else if (last.left || !i) last.right = section
                else last.left = section
            }
            else {
                if (last.center || last.left) newSpread().right = section
                else if (last.right || !i) last.left = section
                else last.right = section
            }
            return arr
        }, [{}])
    }
    get index() {
        const spread = this.#spreads[this.#index]
        const section = spread?.center ?? (this.#side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)
        return this.book.sections.indexOf(section)
    }
    #reportLocation(reason) {
        this.dispatchEvent(new CustomEvent('relocate', { detail:
            { reason, range: null, index: this.index, fraction: 0, size: 1 } }))
    }
    getSpreadOf(section) {
        const spreads = this.#spreads
        for (let index = 0; index < spreads.length; index++) {
            const { left, right, center } = spreads[index]
            if (left === section) return { index, side: 'left' }
            if (right === section) return { index, side: 'right' }
            if (center === section) return { index, side: 'center' }
        }
    }
    async goToSpread(index, side, reason) {
        if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')
        if (index < 0 || index > this.#spreads.length - 1) return
        if (index === this.#index) {
            this.#side = side
            this.#render(side)
            this.#reportLocation(reason)
            return
        }
        this.#index = index
        const spread = this.#spreads[index]
        if (spread.center) {
            const index = this.book.sections.indexOf(spread.center)
            const src = await __hnRaceRendererLoad(this.__hnTrackSectionLoad(spread.center), this.__hnCancellation)
            if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')
            await this.#showSpread({ center: { index, src } })
        } else {
            const indexL = this.book.sections.indexOf(spread.left)
            const indexR = this.book.sections.indexOf(spread.right)
            const srcL = await __hnRaceRendererLoad(this.__hnTrackSectionLoad(spread.left), this.__hnCancellation)
            if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')
            const srcR = await __hnRaceRendererLoad(this.__hnTrackSectionLoad(spread.right), this.__hnCancellation)
            if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')
            const left = { index: indexL, src: srcL }
            const right = { index: indexR, src: srcR }
            await this.#showSpread({ left, right, side })
        }
        this.#reportLocation(reason)
    }
    async select(target) {
        await this.goTo(target)
        // TODO
    }
    async goTo(target) {
        if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')
        const { book } = this
        const resolved = await target
        const section = book.sections[resolved.index]
        if (!section) return
        const { index, side } = this.getSpreadOf(section)
        await this.goToSpread(index, side)
    }
    async next() {
        const s = this.rtl ? this.#goLeft() : this.#goRight()
        if (!s) return this.goToSpread(this.#index + 1, this.rtl ? 'right' : 'left', 'page')
    }
    async prev() {
        const s = this.rtl ? this.#goRight() : this.#goLeft()
        if (!s) return this.goToSpread(this.#index - 1, this.rtl ? 'left' : 'right', 'page')
    }
    getContents() {
        return Array.from(this.#root.querySelectorAll('iframe'), frame => ({
            doc: frame.contentDocument,
            // TODO: index, overlayer
        }))
    }
    cancelPendingLoad() {
        this.__hnCancelled = true
        this.invalidatePendingLoads()
        this.__hnCancellation?.reject(new Error('HN_FOLIATE_LOAD_CANCELLED'))
        for (const cancel of this.__hnPendingFrames) cancel()
    }
    __hnTrackSectionLoad(section) {
        return __hnTrackRendererLoad(this, section)
    }
    invalidatePendingLoads() {
        __hnInvalidateRendererLoads(this)
    }
    destroy() {
        this.cancelPendingLoad()
        this.#observer.disconnect()
        this.#root.replaceChildren()
    }
}

customElements.define('foliate-fxl', FixedLayout)
