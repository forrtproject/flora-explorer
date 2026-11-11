import {token} from './chartUtils.js';

export const CI_COLORS = {
    get failed() { return token('--color-chart-failed'); },
    get successful() { return token('--color-chart-successful'); },
    get mixed() { return token('--color-chart-mixed'); },
    get all() { return token('--color-primary'); },
};

// Shareable ?tab=citations&doi=… link, relative to the current page so project paths work.
export const citationLink = doi => {
    const url = new URL(location.href); url.searchParams.set('tab', 'citations'); url.searchParams.set('doi', doi); return url.href;
};
