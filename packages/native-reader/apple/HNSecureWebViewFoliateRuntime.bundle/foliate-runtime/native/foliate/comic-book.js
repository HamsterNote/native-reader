export const __hnCommitComicUrls = (book, cache, urls, name, src, page) => {
    if (book.__hnInvalidated) {
        URL.revokeObjectURL(src)
        URL.revokeObjectURL(page)
        throw new Error('HN_FOLIATE_LOAD_CANCELLED')
    }
    urls.set(name, [src, page])
    cache.set(name, page)
    return page
}

export const makeComicBook = ({ entries, loadBlob, getSize }, file) => {
    const cache = new Map()
    const urls = new Map()
    const load = async name => {
        if (cache.has(name)) return cache.get(name)
        const imageTypes = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', jxl: 'image/jxl' }
        const src = URL.createObjectURL(await loadBlob(name, imageTypes[name.split('.').at(-1)]))
        if (book.__hnInvalidated) {
            URL.revokeObjectURL(src)
            throw new Error('HN_FOLIATE_LOAD_CANCELLED')
        }
        const page = URL.createObjectURL(
            new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin: 0"><img src="${src}"></body></html>`], { type: 'text/html' }))
        __hnCommitComicUrls(book, cache, urls, name, src, page)
        return page
    }
    const unload = name => {
        urls.get(name)?.forEach?.(url => URL.revokeObjectURL(url))
        urls.delete(name)
        cache.delete(name)
    }

    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.jxl', '.avif']
    const files = entries
        .map(entry => entry.filename)
        .filter(name => exts.some(ext => name.endsWith(ext)))
        .sort(new Intl.Collator([], { numeric: true }).compare)
    if (!files.length) throw new Error('No supported image files in archive')

    const book = {}
    book.__hnInvalidated = false
    book.getCover = () => loadBlob(files[0])
    book.metadata = { title: file.name }
    book.sections = files.map(name => ({
        id: name,
        load: () => load(name),
        unload: () => unload(name),
        invalidate: () => book.invalidate(),
        size: getSize(name),
    }))
    book.toc = files.map(name => ({ label: name, href: name }))
    book.rendition = { layout: 'pre-paginated' }
    book.resolveHref = href => ({ index: book.sections.findIndex(s => s.id === href) })
    book.splitTOCHref = href => [href, null]
    book.getTOCFragment = doc => doc.documentElement
    const releaseResources = () => {
        for (const arr of urls.values())
            for (const url of arr) URL.revokeObjectURL(url)
        urls.clear()
        cache.clear()
    }
    book.invalidate = () => {
        book.__hnInvalidated = true
        releaseResources()
    }
    book.destroy = () => {
        releaseResources()
    }
    return book
}
