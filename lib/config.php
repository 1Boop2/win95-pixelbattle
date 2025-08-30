<?php
declare(strict_types=1);

const DB_DSN  = 'mysql:host=localhost;dbname=pixelpaint95;charset=utf8mb4';
const DB_USER = 'pixelpaint95';
const DB_PASS = 'gQ6fI9yV3v';

const SERVER_SECRET = 'CHANGE_ME_LONG_RANDOM_SECRET';
const ALLOWED_ORIGIN = '';

const PALETTE = [
  '#000000','#800000','#008000','#808000',
  '#000080','#800080','#008080','#C0C0C0',
  '#808080','#FF0000','#00FF00','#FFFF00',
  '#0000FF','#FF00FF','#00FFFF','#FFFFFF',
];

const CANVAS_W = 500;
const CANVAS_H = 500;
const COOLDOWN_SECONDS = 1;
const SSE_DB_POLL_MS = 200;
const SSE_HEARTBEAT_MS = 1000;

// Cookie
const COOKIE_NAME = 'pp95';
const COOKIE_MAX_AGE = 31536000; // 1 year
