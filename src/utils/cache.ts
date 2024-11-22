import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 600});

export const setCache = (key: string, value: unknown) => {
    cache.set(key, value);
};

export const getCache = (key: string) => {
    return cache.get(key);
}