const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const needle = require('needle');
const { VM } = require('vm2');

// ========================================
// Configuration
// ========================================
const BASE_URL = 'https://kisskh.ovh';
const API_URL = `${BASE_URL}/api/DramaList`;

const PORT = process.env.PORT || 7000;

// MediaFlow Proxy Configuration (set via environment variables)
const MEDIAFLOW_PROXY_URL = process.env.MEDIAFLOW_PROXY_URL || '';
const MEDIAFLOW_API_PASSWORD = process.env.MEDIAFLOW_API_PASSWORD || '';

// Validate required environment variables
if (!MEDIAFLOW_PROXY_URL || !MEDIAFLOW_API_PASSWORD) {
    console.warn('⚠️  WARNING: MEDIAFLOW_PROXY_URL or MEDIAFLOW_API_PASSWORD not set.');
    console.warn('   Streams may not work without MediaFlow Proxy configuration.');
    console.warn('   Set these environment variables before running in production.');
}

const SEARCH_TYPES = {
    'asian-drama': { code: 1, name: 'Asian Drama', stremioType: 'series' },
    'asian-movies': { code: 2, name: 'Asian Movies', stremioType: 'movie' },
    'anime': { code: 3, name: 'Anime', stremioType: 'series' },
    'hollywood': { code: 4, name: 'Hollywood', stremioType: 'movie' }
};

// Token generation parameters from kisskh-dl
const TOKEN_CONFIG = {
    subGuid: 'VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp',
    viGuid: '62f176f3bb1b5b8e70e39932ad34a0c7',
    appVer: '2.8.10',
    platformVer: 4830201,
    appName: 'kisskh'
};

// Headers to mimic browser
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': BASE_URL + '/',
    'Origin': BASE_URL
};

// Cache for token generation JS code
let tokenGenerationCode = null;

// ========================================
// MediaFlow Proxy Helper
// ========================================

// Language code mapping for Stremio (ISO 639-1 - 2 letter codes)
const LANGUAGE_CODES = {
    'English': 'en',
    'French': 'fr',
    'Indonesia': 'id',
    'Indonesian': 'id',
    'Malay': 'ms',
    'Arabic': 'ar',
    'Khmer': 'km',
    'Spanish': 'es',
    'Portuguese': 'pt',
    'German': 'de',
    'Italian': 'it',
    'Korean': 'ko',
    'Japanese': 'ja',
    'Chinese': 'zh',
    'Thai': 'th',
    'Vietnamese': 'vi',
    'Hindi': 'hi',
    'Russian': 'ru',
    'Turkish': 'tr',
    'Polish': 'pl',
    'Dutch': 'nl',
    'Greek': 'el',
    'Hebrew': 'he',
    'Romanian': 'ro',
    'Czech': 'cs',
    'Hungarian': 'hu',
    'Swedish': 'sv',
    'Danish': 'da',
    'Finnish': 'fi',
    'Norwegian': 'no'
};

function buildMediaFlowUrl(videoUrl, isHLS = false) {
    // Determine the endpoint based on stream type
    const endpoint = isHLS ? '/proxy/hls/manifest.m3u8' : '/proxy/stream';

    // Build the proxy URL with parameters
    const params = new URLSearchParams({
        'd': videoUrl,
        'h_referer': BASE_URL + '/',
        'h_origin': BASE_URL,
        'h_user-agent': HEADERS['User-Agent'],
        'api_password': MEDIAFLOW_API_PASSWORD
    });

    // Remove trailing slash from proxy URL to avoid double slashes
    const baseUrl = MEDIAFLOW_PROXY_URL.replace(/\/+$/, '');
    return `${baseUrl}${endpoint}?${params.toString()}`;
}

// Format subtitles for Stremio with proper ISO 639-1 language codes
function formatSubtitlesForStremio(subtitles) {
    if (!subtitles || !Array.isArray(subtitles)) return [];

    return subtitles.map((sub, index) => {
        const langName = sub.label || sub.language || 'Unknown';
        const langCode = LANGUAGE_CODES[langName] || langName.toLowerCase().substring(0, 2);

        return {
            id: `${index}-${langCode}`,
            url: sub.src,  // Direct URL - these have CORS headers already
            lang: langCode
        };
    });
}


// ========================================
// Manifest
// ========================================
const manifest = {
    id: 'community.kisskh.fr',
    version: '1.5.0',
    name: 'KissKH 🇫🇷',
    description: 'Asian Dramas, Movies, Anime with French subtitles from KissKH',
    logo: 'https://kisskh.ovh/favicon.ico',
    resources: ['catalog', 'meta', 'stream', 'subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['kisskh:', 'tt'],
    catalogs: [
        {
            type: 'series',
            id: 'kisskh-asian-drama',
            name: 'KissKH Asian Drama',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ]
        },
        {
            type: 'movie',
            id: 'kisskh-asian-movies',
            name: 'KissKH Asian Movies',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ]
        },
        {
            type: 'series',
            id: 'kisskh-anime',
            name: 'KissKH Anime',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ]
        },
        {
            type: 'movie',
            id: 'kisskh-hollywood',
            name: 'KissKH Hollywood',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ]
        }
    ],
    behaviorHints: {
        adult: false,
        p2p: false
    }
};

// ========================================
// API Helper Functions
// ========================================

async function makeRequest(url, options = {}, retries = 3) {
    const opts = {
        headers: { ...HEADERS, ...options.headers },
        json: options.json !== false,
        follow_max: 5,
        timeout: 20000  // Increased timeout
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await needle('get', url, opts);
            if (response.statusCode >= 200 && response.statusCode < 300) {
                return response.body;
            }

            // Retry on 502, 503, 504 errors
            if ([502, 503, 504].includes(response.statusCode) && attempt < retries) {
                const delay = attempt * 1000; // 1s, 2s, 3s
                console.warn(`Request failed (${response.statusCode}), retrying in ${delay}ms... (${attempt}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            console.error(`Request failed: ${url} - Status: ${response.statusCode}`);
            return null;
        } catch (error) {
            if (attempt < retries) {
                const delay = attempt * 1000;
                console.warn(`Request error, retrying in ${delay}ms... (${attempt}/${retries}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            console.error(`Request error: ${url}`, error.message);
            return null;
        }
    }
    return null;
}

// Fetch token generation JavaScript code from KissKH
async function fetchTokenGenerationCode() {
    if (tokenGenerationCode) return tokenGenerationCode;

    try {
        const response = await needle('get', BASE_URL, {
            headers: HEADERS,
            follow_max: 5,
            timeout: 15000
        });

        if (!response.body) return null;
        const html = response.body;

        // Find common.js script URL
        const scriptMatch = html.match(/src="([^"]*common[^"]*\.js[^"]*)"/);
        if (!scriptMatch) {
            console.error('Could not find common.js script');
            return null;
        }

        const jsPath = scriptMatch[1];
        const jsUrl = jsPath.startsWith('/') ? `${BASE_URL}${jsPath}` : `${BASE_URL}/${jsPath}`;

        console.log(`Fetching token code from: ${jsUrl}`);

        const jsResponse = await needle('get', jsUrl, {
            headers: HEADERS,
            timeout: 15000
        });

        if (jsResponse.body) {
            tokenGenerationCode = jsResponse.body;
            return tokenGenerationCode;
        }
        return null;
    } catch (error) {
        console.error('Error fetching token generation code:', error.message);
        return null;
    }
}

// Generate token for API calls using VM2
async function generateToken(episodeId, uid) {
    try {
        const jsCode = await fetchTokenGenerationCode();
        if (!jsCode) {
            console.error('No token generation code available');
            return '';
        }

        // Create a VM with browser-like environment
        const vm = new VM({
            timeout: 5000,
            sandbox: {
                window: {
                    document: { URL: BASE_URL },
                    navigator: {
                        userAgent: HEADERS['User-Agent'],
                        platform: 'Win32',
                        appCodeName: 'Mozilla',
                        appName: 'Netscape'
                    }
                }
            }
        });

        // The token function is referenced as _0x54b991 in the obfuscated code
        const evalCode = `
            ${jsCode}
            _0x54b991(${episodeId}, null, "${TOKEN_CONFIG.appVer}", "${uid}", ${TOKEN_CONFIG.platformVer}, "${TOKEN_CONFIG.appName}", "${TOKEN_CONFIG.appName}", "${TOKEN_CONFIG.appName}", "${TOKEN_CONFIG.appName}", "${TOKEN_CONFIG.appName}", "${TOKEN_CONFIG.appName}");
        `;

        const token = vm.run(evalCode);
        console.log(`Generated token for episode ${episodeId}: ${token ? token.substring(0, 20) + '...' : 'null'}`);
        return token || '';
    } catch (error) {
        console.error('Token generation error:', error.message);
        return '';
    }
}

// ========================================
// Search Functions
// ========================================

async function searchKissKH(query, typeCode = null) {
    const results = [];
    const encodedQuery = encodeURIComponent(query);

    const typesToSearch = typeCode
        ? [{ code: typeCode, name: Object.values(SEARCH_TYPES).find(t => t.code === typeCode)?.name }]
        : Object.values(SEARCH_TYPES);

    for (const type of typesToSearch) {
        try {
            const searchUrl = `${API_URL}/Search?q=${encodedQuery}&type=${type.code}`;
            console.log(`Searching: ${searchUrl}`);
            const data = await makeRequest(searchUrl);

            if (data && Array.isArray(data)) {
                for (const item of data.slice(0, 20)) {
                    results.push({
                        ...item,
                        searchType: type.name,
                        typeCode: type.code
                    });
                }
            }
        } catch (error) {
            console.error(`Search error for type ${type.name}:`, error.message);
        }
    }

    return results;
}

async function getSeriesDetails(seriesId) {
    try {
        const url = `${API_URL}/Drama/${seriesId}`;
        return await makeRequest(url);
    } catch (error) {
        console.error(`Error fetching series ${seriesId}:`, error.message);
        return null;
    }
}

async function getEpisodeStream(episodeId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const token = await generateToken(episodeId, TOKEN_CONFIG.viGuid);
            const url = `${API_URL}/Episode/${episodeId}.png?kkey=${token}`;
            console.log(`Fetching stream (attempt ${attempt}/${retries}): ${url}`);

            const response = await needle('get', url, {
                headers: HEADERS,
                follow_max: 5,
                timeout: 20000
            });

            console.log(`Stream response status: ${response.statusCode}`);

            // Retry on 502, 503, 504 errors
            if ([502, 503, 504].includes(response.statusCode) && attempt < retries) {
                const delay = attempt * 1500; // 1.5s, 3s, 4.5s
                console.warn(`Stream request failed (${response.statusCode}), retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            if (response.statusCode >= 200 && response.statusCode < 300) {
                let data = response.body;

                // Handle Buffer response
                if (Buffer.isBuffer(data)) {
                    const str = data.toString('utf-8');
                    console.log(`Raw response: ${str.substring(0, 200)}`);
                    try {
                        data = JSON.parse(str);
                    } catch (e) {
                        console.error('Failed to parse buffer as JSON:', e.message);
                        return null;
                    }
                } else if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch (e) {
                        console.error('Failed to parse string as JSON');
                        return null;
                    }
                }

                console.log(`Stream Video URL: ${data?.Video?.substring(0, 100) || 'null'}`);
                return data;
            }
            console.error(`Stream request failed with status: ${response.statusCode}`);
            return null;
        } catch (error) {
            if (attempt < retries) {
                const delay = attempt * 1500;
                console.warn(`Stream error, retrying in ${delay}ms... (${attempt}/${retries}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            console.error(`Error fetching episode stream ${episodeId}:`, error.message);
            return null;
        }
    }
    return null;
}

async function getSubtitles(episodeId) {
    try {
        const token = await generateToken(episodeId, TOKEN_CONFIG.subGuid);
        const url = `${BASE_URL}/api/Sub/${episodeId}?kkey=${token}`;

        const response = await needle('get', url, {
            headers: HEADERS,
            follow_max: 5,
            timeout: 15000
        });

        if (response.statusCode >= 200 && response.statusCode < 300) {
            let data = response.body;

            // Handle Buffer response
            if (Buffer.isBuffer(data)) {
                try {
                    data = JSON.parse(data.toString('utf-8'));
                } catch (e) {
                    console.error('Failed to parse subtitles buffer as JSON:', e.message);
                    return null;
                }
            } else if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    console.error('Failed to parse subtitles string as JSON');
                    return null;
                }
            }

            return data;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching subtitles ${episodeId}:`, error.message);
        return null;
    }
}

// Fetch metadata from Cinemeta (Stremio's default metadata addon)
async function getCinemetaMeta(type, imdbId) {
    try {
        const url = `https://cinemeta-live.strem.io/meta/${type}/${imdbId}.json`;
        console.log(`Fetching Cinemeta: ${url}`);
        const response = await needle('get', url, { json: true, timeout: 10000, follow_max: 5 });

        if (response.statusCode === 200 && response.body && response.body.meta) {
            return response.body.meta;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching Cinemeta:`, error.message);
        return null;
    }
}

// Parse IMDb-style ID: tt1234567 or tt1234567:1:5 (for series: imdbId:season:episode)
function parseImdbId(id) {
    // Handle series format: tt1234567:1:5 (imdb:season:episode)
    const sMatch = id.match(/^(tt\d+):(\d+):(\d+)$/);
    if (sMatch) {
        return {
            imdbId: sMatch[1],
            season: parseInt(sMatch[2]),
            episode: parseInt(sMatch[3])
        };
    }

    // Handle movie format: tt1234567
    const mMatch = id.match(/^(tt\d+)$/);
    if (mMatch) {
        return {
            imdbId: mMatch[1],
            season: null,
            episode: null
        };
    }

    return null;
}

// Build stream info object
async function buildStreamFromKissKH(seriesId, episodeId) {
    const streams = [];

    const streamData = await getEpisodeStream(episodeId);

    if (streamData && streamData.Video) {
        const videoUrl = streamData.Video;

        // Check if it's not a countdown (unreleased)
        if (!videoUrl.includes('tickcounter.com')) {
            // Try to get subtitles first - we only show streams with French subtitles
            let subtitles = [];
            let hasFrenchSubs = false;

            try {
                const rawSubtitles = await getSubtitles(episodeId);
                if (rawSubtitles && Array.isArray(rawSubtitles) && rawSubtitles.length > 0) {
                    // Check if French subtitles are available
                    hasFrenchSubs = rawSubtitles.some(sub => {
                        const label = (sub.label || sub.language || '').toLowerCase();
                        return label === 'french' || label === 'français' || label === 'fr';
                    });

                    if (hasFrenchSubs) {
                        // Format all subtitles for Stremio with proper ISO codes
                        subtitles = formatSubtitlesForStremio(rawSubtitles);
                        console.log(`Found ${subtitles.length} subtitles, including French`);
                    } else {
                        console.log(`No French subtitles found for episode ${episodeId}`);
                    }
                }
            } catch (subError) {
                console.error('Error fetching subtitles:', subError.message);
            }

            // Only add stream if it has French subtitles
            if (hasFrenchSubs) {
                // Determine quality from URL if possible
                let quality = 'HD';
                if (videoUrl.includes('1080')) quality = '1080p';
                else if (videoUrl.includes('720')) quality = '720p';
                else if (videoUrl.includes('480')) quality = '480p';

                const isHLS = videoUrl.includes('.m3u8');

                // Build MediaFlow Proxy URL
                const proxiedUrl = buildMediaFlowUrl(videoUrl, isHLS);
                console.log(`MediaFlow URL: ${proxiedUrl.substring(0, 100)}...`);

                const streamInfo = {
                    name: 'KissKH 🇫🇷',
                    title: `${quality} ${isHLS ? '(HLS)' : '(MP4)'} - French Subs`,
                    url: proxiedUrl,
                    subtitles: subtitles,
                    behaviorHints: {
                        bingeGroup: `kisskh-${seriesId}`,
                        audioLanguages: ['fr'],
                        subtitleLanguages: ['fr']
                    }
                };

                streams.push(streamInfo);

                // Also add direct stream as backup with same subtitles
                streams.push({
                    name: 'KissKH Direct 🇫🇷',
                    title: `${quality} ${isHLS ? '(HLS)' : '(MP4)'} Direct - French Subs`,
                    url: videoUrl,
                    subtitles: subtitles,
                    behaviorHints: {
                        bingeGroup: `kisskh-${seriesId}`,
                        notWebReady: isHLS,
                        audioLanguages: ['fr'],
                        subtitleLanguages: ['fr'],
                        proxyHeaders: {
                            request: {
                                'Referer': BASE_URL + '/',
                                'Origin': BASE_URL
                            }
                        }
                    }
                });
            }
        } else {
            console.log('Episode not yet released (countdown found)');
        }
    }

    return streams;
}


// ========================================
// Convert to Stremio format
// ========================================

function convertToMeta(item, isDetailed = false) {
    const isMovie = item.type?.toLowerCase() === 'movie' || item.episodesCount === 1;
    const year = item.releaseDate?.split('-')[0] || item.releaseDate?.split('T')[0]?.split('-')[0] || '';

    const meta = {
        id: `kisskh:${item.id}`,
        type: isMovie ? 'movie' : 'series',
        name: item.title,
        poster: item.thumbnail || item.poster,
        background: item.thumbnail || item.poster,
        description: item.description || `${item.country || ''} ${item.status || ''}`.trim(),
        releaseInfo: year,
        imdbRating: item.rating || null,
        genres: item.genres?.map(g => g.name || g) || [],
        country: item.country
    };

    // Add episode information for series
    if (isDetailed && !isMovie && item.episodes && item.episodes.length > 0) {
        // Sort episodes by number
        const sortedEpisodes = [...item.episodes].sort((a, b) => {
            const numA = parseFloat(a.number) || 0;
            const numB = parseFloat(b.number) || 0;
            return numA - numB;
        });

        meta.videos = sortedEpisodes.map(ep => {
            const epNumber = parseFloat(ep.number);
            const epInt = Math.floor(epNumber);
            return {
                id: `kisskh:${item.id}:${ep.id}`,
                title: `Episode ${epNumber}`,
                season: 1,
                episode: epInt,
                released: ep.createdDate || item.releaseDate
            };
        });
    }

    return meta;
}

// ========================================
// Stremio Handlers
// ========================================

const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`Catalog request: type=${type}, id=${id}, extra=`, extra);

    const metas = [];

    // Determine which type to search
    const catalogType = id.replace('kisskh-', '');
    const typeConfig = SEARCH_TYPES[catalogType];

    if (extra.search) {
        // Search mode
        const results = await searchKissKH(extra.search, typeConfig?.code);

        for (const item of results) {
            // Get detailed info for each result
            const details = await getSeriesDetails(item.id);
            if (details) {
                const meta = convertToMeta(details);
                // Filter by type
                if ((type === 'movie' && meta.type === 'movie') ||
                    (type === 'series' && meta.type === 'series')) {
                    metas.push(meta);
                }
            }
        }
    } else {
        // Default catalog - search for common terms or show recent
        const defaultSearchTerms = ['2024', '2025', 'love', 'drama'];

        for (const term of defaultSearchTerms) {
            const results = await searchKissKH(term, typeConfig?.code);

            for (const item of results.slice(0, 10)) {
                // Check if already in metas
                if (metas.find(m => m.id === `kisskh:${item.id}`)) continue;

                const details = await getSeriesDetails(item.id);
                if (details) {
                    const meta = convertToMeta(details);
                    if ((type === 'movie' && meta.type === 'movie') ||
                        (type === 'series' && meta.type === 'series')) {
                        metas.push(meta);
                    }
                }

                if (metas.length >= 20) break;
            }

            if (metas.length >= 20) break;
        }
    }

    return { metas };
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`Meta request: type=${type}, id=${id}`);

    const kisshkId = id.replace('kisskh:', '').split(':')[0];
    const details = await getSeriesDetails(kisshkId);

    if (!details) {
        return { meta: null };
    }

    const meta = convertToMeta(details, true);
    return { meta };
});

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`Stream request: type=${type}, id=${id}`);

    const streams = [];

    try {
        // Check if this is a KissKH internal ID
        if (id.startsWith('kisskh:')) {
            // Parse ID format: kisskh:seriesId or kisskh:seriesId:episodeId
            const parts = id.replace('kisskh:', '').split(':');
            const seriesId = parts[0];
            let episodeId = parts[1];

            // If no episode ID, get the series info first
            if (!episodeId) {
                const details = await getSeriesDetails(seriesId);
                if (details && details.episodes && details.episodes.length > 0) {
                    // For movies, get the first/only episode
                    const sortedEpisodes = [...details.episodes].sort((a, b) => {
                        return parseFloat(a.number) - parseFloat(b.number);
                    });
                    episodeId = sortedEpisodes[0].id;
                }
            }

            if (episodeId) {
                const kisskhStreams = await buildStreamFromKissKH(seriesId, episodeId);
                streams.push(...kisskhStreams);
            }
        }
        // Handle IMDb IDs (from Cinemata and other addons)
        else if (id.startsWith('tt')) {
            const parsed = parseImdbId(id);

            if (parsed) {
                console.log(`Parsed IMDb ID: ${parsed.imdbId}, Season: ${parsed.season}, Episode: ${parsed.episode}`);

                // Get title from Cinemeta
                const meta = await getCinemetaMeta(type, parsed.imdbId);

                if (meta && meta.name) {
                    console.log(`Searching KissKH for: "${meta.name}"`);

                    // Search KissKH for this title
                    const searchResults = await searchKissKH(meta.name);

                    if (searchResults.length > 0) {
                        console.log(`Found ${searchResults.length} results in KissKH`);

                        // Try to find the best match
                        for (const result of searchResults.slice(0, 3)) {
                            const details = await getSeriesDetails(result.id);

                            if (!details || !details.episodes || details.episodes.length === 0) {
                                continue;
                            }

                            // Check if title matches reasonably well
                            const resultTitle = details.title?.toLowerCase() || '';
                            const searchTitle = meta.name.toLowerCase();

                            // Allow partial match
                            if (!resultTitle.includes(searchTitle) && !searchTitle.includes(resultTitle)) {
                                // Try word-by-word matching
                                const searchWords = searchTitle.split(/\s+/);
                                const resultWords = resultTitle.split(/\s+/);
                                const matchingWords = searchWords.filter(w => resultWords.some(rw => rw.includes(w) || w.includes(rw)));

                                if (matchingWords.length < Math.min(2, searchWords.length)) {
                                    continue;
                                }
                            }

                            // Sort episodes by number
                            const sortedEpisodes = [...details.episodes].sort((a, b) => {
                                return parseFloat(a.number) - parseFloat(b.number);
                            });

                            let targetEpisode;

                            if (type === 'movie' || (parsed.season === null && parsed.episode === null)) {
                                // For movies, get the first episode
                                targetEpisode = sortedEpisodes[0];
                            } else if (parsed.season !== null && parsed.episode !== null) {
                                // For series, find matching episode
                                // KissKH uses episode numbers, not season+episode
                                // Try to find exact episode number match first
                                targetEpisode = sortedEpisodes.find(ep => {
                                    const epNum = parseFloat(ep.number);
                                    return epNum === parsed.episode;
                                });

                                // If not found and season > 1, calculate cumulative episode number
                                // This is a rough heuristic that may not always work
                                if (!targetEpisode && parsed.season > 1) {
                                    console.log(`Episode ${parsed.episode} not found, this might be a multi-season show`);
                                }

                                // Fallback: just use the episode number directly
                                if (!targetEpisode && parsed.episode <= sortedEpisodes.length) {
                                    targetEpisode = sortedEpisodes[parsed.episode - 1];
                                }
                            }

                            if (targetEpisode) {
                                console.log(`Found matching episode: ${targetEpisode.id} (${targetEpisode.number})`);

                                const kisskhStreams = await buildStreamFromKissKH(details.id, targetEpisode.id);

                                if (kisskhStreams.length > 0) {
                                    // Add source info to stream titles
                                    for (const stream of kisskhStreams) {
                                        stream.title = `${details.title}\n${stream.title}`;
                                    }
                                    streams.push(...kisskhStreams);
                                    break; // Found streams, no need to check more results
                                }
                            }
                        }
                    } else {
                        console.log(`No results found in KissKH for: "${meta.name}"`);
                    }
                } else {
                    console.log(`Could not get metadata from Cinemeta for: ${id}`);
                }
            }
        }
    } catch (error) {
        console.error('Stream handler error:', error.message);
    }

    console.log(`Returning ${streams.length} streams`);
    return { streams };
});

// Subtitles handler - provides subtitles separately from stream
builder.defineSubtitlesHandler(async ({ type, id, extra }) => {
    console.log(`Subtitles request: type=${type}, id=${id}`);

    const subtitles = [];

    // Parse ID format: kisskh:seriesId or kisskh:seriesId:episodeId
    const parts = id.replace('kisskh:', '').split(':');
    const seriesId = parts[0];
    let episodeId = parts[1];

    try {
        // If no episode ID, get the series info first
        if (!episodeId) {
            const details = await getSeriesDetails(seriesId);
            if (details && details.episodes && details.episodes.length > 0) {
                const sortedEpisodes = [...details.episodes].sort((a, b) => {
                    return parseFloat(a.number) - parseFloat(b.number);
                });
                episodeId = sortedEpisodes[0].id;
            }
        }

        if (episodeId) {
            const rawSubtitles = await getSubtitles(episodeId);
            if (rawSubtitles && Array.isArray(rawSubtitles) && rawSubtitles.length > 0) {
                // Format subtitles for Stremio
                for (const sub of rawSubtitles) {
                    const langName = sub.label || sub.language || 'Unknown';
                    const langCode = LANGUAGE_CODES[langName] || langName.toLowerCase().substring(0, 2);

                    subtitles.push({
                        id: `kisskh-${langCode}`,
                        url: sub.src,
                        lang: langCode
                    });
                }
                console.log(`Returning ${subtitles.length} subtitles`);
            }
        }
    } catch (error) {
        console.error('Subtitles handler error:', error.message);
    }

    return { subtitles };
});

// ========================================
// Start Stremio Addon Server
// ========================================

serveHTTP(builder.getInterface(), { port: PORT });

console.log(`
╔════════════════════════════════════════════════════════════╗
║                    KissKH Stremio Addon                    ║
╠════════════════════════════════════════════════════════════╣
║  Addon URL: http://localhost:${PORT}/manifest.json
║  MediaFlow Proxy: ${MEDIAFLOW_PROXY_URL}
║                                                            ║
║  Install in Stremio:                                       ║
║  1. Open Stremio                                           ║
║  2. Go to Addons                                           ║
║  3. Click "Community Addons"                               ║
║  4. Enter the addon URL above                              ║
╚════════════════════════════════════════════════════════════╝
`);
