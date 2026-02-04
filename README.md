# KissKH Stremio Addon 🇫🇷

A Stremio addon that provides access to Asian dramas, movies, anime, and Hollywood content from KissKH with French subtitle support.

## Features

- 🔍 **Search** - Search for dramas by keyword
- 📺 **Catalogs** - Browse Asian Drama, Asian Movies, Anime, and Hollywood categories
- 🎬 **Streaming** - Direct stream links via MediaFlow Proxy
- 🇫🇷 **French Subtitles** - Only shows content with French subtitles available
- 📝 **Multiple Subtitles** - Supports multiple subtitle languages
- 🎯 **Episode Support** - Full episode listings for TV series

## Docker Installation (Recommended)

### Using Docker Compose

```yaml
version: '3.8'
services:
  kisskh-addon:
    image: ghcr.io/themaluxis/kisskh-addon:latest
    container_name: kisskh-addon
    ports:
      - "7000:7000"
    environment:
      - PORT=7000
      - MEDIAFLOW_PROXY_URL=https://your-mediaflow-proxy.example.com
      - MEDIAFLOW_API_PASSWORD=your_password_here
    restart: unless-stopped
```

### Using Docker Run

```bash
docker run -d \
  --name kisskh-addon \
  -p 7000:7000 \
  -e MEDIAFLOW_PROXY_URL=https://your-mediaflow-proxy.example.com \
  -e MEDIAFLOW_API_PASSWORD=your_password_here \
  ghcr.io/themaluxis/kisskh-addon:latest
```

## Manual Installation

### Prerequisites

- Node.js 18+ 
- npm
- MediaFlow Proxy instance

### Setup

1. Clone or download this repository

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and set your MediaFlow Proxy credentials:
   ```env
   MEDIAFLOW_PROXY_URL=https://your-mediaflow-proxy.example.com
   MEDIAFLOW_API_PASSWORD=your_password_here
   ```

5. Start the addon:
   ```bash
   npm start
   ```

6. The addon will be available at: `http://localhost:7000/manifest.json`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `7000` | Server port |
| `MEDIAFLOW_PROXY_URL` | **Yes** | - | URL of your MediaFlow Proxy instance |
| `MEDIAFLOW_API_PASSWORD` | **Yes** | - | API password for MediaFlow Proxy |

## Adding to Stremio

1. Open Stremio
2. Go to **Addons** (puzzle piece icon)
3. Click on **Community Addons**
4. In the search/URL bar, enter your addon URL (e.g., `http://localhost:7000/manifest.json`)
5. Click **Install**

## MediaFlow Proxy

This addon requires a [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) instance to handle HLS stream proxying with proper headers.

You can:
- Self-host MediaFlow Proxy using Docker
- Use a hosted MediaFlow Proxy service

## Content Types

| Catalog | Stremio Type | Description |
|---------|--------------|-------------|
| Asian Drama | series | Korean, Chinese, Japanese dramas |
| Asian Movies | movie | Asian films |
| Anime | series | Anime series |
| Hollywood | movie | Western movies/series |

## Building Docker Image

```bash
docker build -t kisskh-addon .
```

## Credits

- Based on [kisskh-dl](https://github.com/PurushothMathav/kisskh-dl) by PurushothMathav
- Uses [MediaFlow Proxy](https://github.com/mhdzumair/mediaflow-proxy) for stream handling
- Uses the Stremio Addon SDK

## Disclaimer

This addon is for educational purposes only. The developers are not responsible for any misuse of this addon or any copyright infringement. Users are responsible for ensuring they have the right to access the content in their jurisdiction.

## License

MIT
