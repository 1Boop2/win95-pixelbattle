<?php
declare(strict_types=1);
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/utils.php';
header('Content-Type: application/json; charset=utf-8');

$raw = file_get_contents('php://input');
$in = json_decode($raw ?: '[]', true);
$pixels = $in['pixels'] ?? null;
$dedupe = isset($in['dedupe']) ? (bool)$in['dedupe'] : true;

if (!is_array($pixels)) { fail('bad_request', 400, ['hint'=>'send {pixels:[{x,y,color},...] }']); exit; }
if (count($pixels) === 0) { ok(['painted_count'=>0, 'total_requested'=>0]); exit; }
//if (count($pixels) > MAX_BULK_PIXELS) {
//  fail('too_many_pixels', 413, ['max'=>MAX_BULK_PIXELS, 'total_requested'=>count($pixels)]); exit;
//}

$pdo = db();
$ip = get_client_ip();
$h  = ip_hash($ip);

// Попытаемся найти пользователя по cookie (id.token)


$cooldownSeconds = 0;

// Очистка/валидация/дедуп
$map = [];
$clean = [];
foreach ($pixels as $p) {
  if (!is_array($p)) continue;
  $x = $p['x'] ?? null; $y = $p['y'] ?? null; $c = $p['color'] ?? null;
  if (!is_int($x) || !is_int($y) || !is_int($c)) continue;
  if ($c < 0 || $c > 15) continue;
  $x = clamp_int($x, 0, CANVAS_W - 1);
  $y = clamp_int($y, 0, CANVAS_H - 1);
  if ($dedupe) {
    $map[$x.':'.$y] = $c;
  } else {
    $clean[] = ['x'=>$x,'y'=>$y,'c'=>$c];
  }
}
if ($dedupe) {
  foreach ($map as $k=>$c) {
    [$x,$y] = array_map('intval', explode(':',$k,2));
    $clean[] = ['x'=>$x,'y'=>$y,'c'=>$c];
  }
}

$total = count($clean);
if ($total === 0) { ok(['painted_count'=>0, 'total_requested'=>0]); exit; }

try {
  $pdo->beginTransaction();
  $now_ts = (int)$pdo->query('SELECT UNIX_TIMESTAMP(NOW(6)) AS t')->fetch()['t'];

  if ($cooldownSeconds > 0) {
    // Разрешаем 1 пиксель за запрос (как обычный /paint)
    $stmt = $pdo->prepare('SELECT UNIX_TIMESTAMP(next_allowed_ts) AS next_ts FROM rate_limits WHERE ip_hash = :h FOR UPDATE');
    $stmt->execute([':h' => $h]);
    $rl = $stmt->fetch();
    if ($rl && $now_ts < (int)$rl['next_ts']) {
      $pdo->rollBack();
      fail('cooldown', 429, ['next_allowed_ts' => (int)$rl['next_ts'], 'painted_count'=>0, 'remaining'=>$total]);
      exit;
    }
    // первый пиксель
    $p = $clean[0];
    $pdo->prepare('INSERT INTO rate_limits (ip_hash, next_allowed_ts)
                   VALUES (:h, FROM_UNIXTIME(:ts))
                   ON DUPLICATE KEY UPDATE next_allowed_ts = VALUES(next_allowed_ts)')
        ->execute([':h'=>$h, ':ts'=>$now_ts + $cooldownSeconds]);

    $pdo->prepare('INSERT INTO pixels (x,y,color,updated_at) VALUES (:x,:y,:c,NOW(6))
                   ON DUPLICATE KEY UPDATE color=VALUES(color), updated_at=NOW(6)')
        ->execute([':x'=>$p['x'], ':y'=>$p['y'], ':c'=>$p['c']]);

    $pdo->prepare('INSERT INTO pixel_events (x,y,color,ip_hash,ts) VALUES (:x,:y,:c,:h,NOW(6))')
        ->execute([':x'=>$p['x'], ':y'=>$p['y'], ':c'=>$p['c'], ':h'=>$h]);

    $pdo->commit();
    ok(['painted_count'=>1, 'total_requested'=>$total, 'remaining'=>$total-1, 'cooldown_seconds'=>$cooldownSeconds, 'next_allowed_ts'=>$now_ts + $cooldownSeconds]);
    exit;
  }

  // 0 сек кулдаун — красим всё
  $stmtPix = $pdo->prepare('INSERT INTO pixels (x,y,color,updated_at) VALUES (:x,:y,:c,NOW(6))
                            ON DUPLICATE KEY UPDATE color=VALUES(color), updated_at=NOW(6)');
  $stmtEvt = $pdo->prepare('INSERT INTO pixel_events (x,y,color,ip_hash,ts) VALUES (:x,:y,:c,:h,NOW(6))');
  foreach ($clean as $p) {
    $stmtPix->execute([':x'=>$p['x'], ':y'=>$p['y'], ':c'=>$p['c']]);
    $stmtEvt->execute([':x'=>$p['x'], ':y'=>$p['y'], ':c'=>$p['c'], ':h'=>$h]);
  }
  $pdo->commit();
  ok(['painted_count'=>$total, 'total_requested'=>$total, 'cooldown_seconds'=>0]);

} catch (Throwable $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();
  fail('internal', 500);
}
