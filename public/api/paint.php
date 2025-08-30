<?php
declare(strict_types=1);
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/utils.php';
header('Content-Type: application/json; charset=utf-8');

$raw = file_get_contents('php://input');
$in = json_decode($raw ?: '[]', true);

$x = $in['x'] ?? null;
$y = $in['y'] ?? null;
$color = $in['color'] ?? null;

if (!is_int($x) || !is_int($y) || !is_int($color)) { fail('bad_request', 400); exit; }
$x = clamp_int($x, 0, CANVAS_W - 1);
$y = clamp_int($y, 0, CANVAS_H - 1);
if ($color < 0 || $color > 15) { fail('color_out_of_range', 400); exit; }

$pdo = db();
$ip = get_client_ip();
$h  = ip_hash($ip);

// Попытаемся найти пользователя по cookie (id.token)
$user = null;
if (!empty($_COOKIE[COOKIE_NAME])) {
  $parts = explode('.', $_COOKIE[COOKIE_NAME], 2);
  if (count($parts) === 2 && ctype_digit($parts[0]) && preg_match('/^[a-f0-9]{64}$/', $parts[1])) {
    $uid = (int)$parts[0];
    $tok = $parts[1];
    $stmt = $pdo->prepare('SELECT id, cooldown_override_seconds FROM users WHERE id=:id AND token=:tok');
    $stmt->execute([':id'=>$uid, ':tok'=>$tok]);
    $user = $stmt->fetch();
  }
}

// Определим индивидуальный кулдаун
$cooldownSeconds = COOLDOWN_SECONDS;
if ($user && $user['cooldown_override_seconds'] !== null) {
  $cooldownSeconds = (int)$user['cooldown_override_seconds']; // 0 = no cooldown
}

try {
  $pdo->beginTransaction();

  // Серверное время
  $now_ts = (int)$pdo->query('SELECT UNIX_TIMESTAMP(NOW(6)) AS t')->fetch()['t'];

  if ($cooldownSeconds > 0) {
    // Проверка и установка лимита по IP
    $stmt = $pdo->prepare('SELECT UNIX_TIMESTAMP(next_allowed_ts) AS next_ts FROM rate_limits WHERE ip_hash = :h FOR UPDATE');
    $stmt->execute([':h' => $h]);
    $rl = $stmt->fetch();
    if ($rl && $now_ts < (int)$rl['next_ts']) {
      $pdo->rollBack();
      fail('cooldown', 429, ['next_allowed_ts' => (int)$rl['next_ts']]);
      exit;
    }
    // обновим лимит
    $pdo->prepare('INSERT INTO rate_limits (ip_hash, next_allowed_ts)
                   VALUES (:h, FROM_UNIXTIME(:ts))
                   ON DUPLICATE KEY UPDATE next_allowed_ts = VALUES(next_allowed_ts)')
        ->execute([':h'=>$h, ':ts'=>$now_ts + $cooldownSeconds]);
  }

  // состояние пикселя (апсерт)
  $pdo->prepare('INSERT INTO pixels (x,y,color,updated_at) VALUES (:x,:y,:c,NOW(6))
                 ON DUPLICATE KEY UPDATE color=VALUES(color), updated_at=NOW(6)')
      ->execute([':x'=>$x, ':y'=>$y, ':c'=>$color]);

  // событие
  $pdo->prepare('INSERT INTO pixel_events (x,y,color,ip_hash,ts) VALUES (:x,:y,:c,:h,NOW(6))')
      ->execute([':x'=>$x, ':y'=>$y, ':c'=>$color, ':h'=>$h]);
  $eventId = (int)$pdo->lastInsertId();

  $pdo->commit();

  $nextTs = ($cooldownSeconds > 0) ? ($now_ts + $cooldownSeconds) : $now_ts;
  ok(['event_id'=>$eventId, 'next_allowed_ts'=>$nextTs, 'cooldown_seconds'=>$cooldownSeconds]);

} catch (Throwable $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();
  fail('internal', 500);
}
