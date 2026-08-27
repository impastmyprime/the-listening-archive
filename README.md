# The Listening Archive

The Listening Archive is a private, two-person music archive for saving and revisiting songs shared between two people.

The site is built as a lightweight static web application, with Supabase handling authentication, shared data, realtime synchronization, and server-side utilities.

## Features

- Private two-person access
- Shared song archive
- YouTube playback and automatic link lookup
- Search and sender filtering
- Archive statistics and recommendation timeline
- Personalized unread/new-song indicators
- Realtime updates across devices
- Collaborative pixel board
- Custom desktop cursor system
- Responsive desktop and mobile layouts

## Stack

- HTML
- CSS
- Vanilla JavaScript
- Supabase
  - Authentication
  - PostgreSQL
  - Row Level Security
  - Realtime
  - Edge Functions
- YouTube Data API
- GitHub Pages

## Project Structure

```text
.
├── index.html
├── assets
│   ├── css
│   │   └── styles.css
│   ├── js
│   │   ├── app.js
│   │   └── mobile-title-gap.js
│   ├── cursors
│   │   ├── arrow.svg
│   │   ├── cat.svg
│   │   ├── hover.svg
│   │   └── click.svg
│   └── images
│       ├── favicon.svg
│       └── ...
└── SUPABASE_PIXEL_BOARD_40X20.sql