<?php
declare(strict_types=1);
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/utils.php';

header('Content-Type: application/json; charset=utf-8');

$pdo = db();
$ip = get_client_ip();
$h  = ip_hash($ip);

// nick из тела (необязательно)
$raw = file_get_contents('php://input');
$in = json_decode($raw ?: '[]', true);
$nick = $in['nick'] ?? null;
if (!is_string($nick) || $nick === '') { $nick = 'Guest'; }
$nick = mb_substr($nick, 0, 32);

// проверим cookie
$user = null;
if (!empty($_COOKIE[COOKIE_NAME])) {
  $parts = explode('.', $_COOKIE[COOKIE_NAME], 2);
  if (count($parts) === 2 && ctype_digit($parts[0]) && preg_match('/^[a-f0-9]{64}$/', $parts[1])) {
    $uid = (int)$parts[0];
    $tok = $parts[1];
    $stmt = $pdo->prepare('SELECT id,nick,token,cooldown_override_seconds FROM users WHERE id=:id AND token=:tok');
    $stmt->execute([':id'=>$uid, ':tok'=>$tok]);
    $user = $stmt->fetch();
  }
}

if ($user) {
  // обновим last_ip_hash и при желании ник
  $pdo->prepare('UPDATE users SET last_ip_hash=:h, nick=:n WHERE id=:id')->execute([':h'=>$h, ':n'=>$nick, ':id'=>$user['id']]);
} else {
  // создаём нового
  $token = bin2hex(random_bytes(32));
  $stmt = $pdo->prepare('INSERT INTO users (nick, token, cooldown_override_seconds, created_at, last_ip_hash) VALUES (:n, :t, NULL, NOW(), :h)');
  $stmt->execute([':n'=>$nick, ':t'=>$token, ':h'=>$h]);
  $uid = (int)$pdo->lastInsertId();
  $user = ['id'=>$uid, 'nick'=>$nick, 'token'=>$token, 'cooldown_override_seconds'=>null];
  // Set-Cookie
  setcookie(COOKIE_NAME, $uid.'.'.$token, [
    'expires'  => time() + COOKIE_MAX_AGE,
    'path'     => '/',
    'secure'   => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on',
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
}

ok([
  'user_id' => (int)$user['id'],
  'nick'    => $nick,
  'cooldown_override_seconds' => is_null($user['cooldown_override_seconds']) ? null : (int)$user['cooldown_override_seconds'],
]);
