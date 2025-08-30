<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

function get_client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }
function ip_hash(string $ip): string { return hash_hmac('sha256', $ip, SERVER_SECRET); }

function json_response(array $data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  if (ALLOWED_ORIGIN !== '') header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
}

function clamp_int($v, int $min, int $max): int { return max($min, min((int)$v, $max)); }
function ok(array $extra = []): void { json_response(['ok'=>true] + $extra, 200); }
function fail(string $msg, int $status = 400, array $extra = []): void { json_response(['error'=>$msg] + $extra, $status); }
