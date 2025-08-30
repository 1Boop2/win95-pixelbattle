<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/utils.php';
ignore_user_abort(true); set_time_limit(0);
@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
@ini_set('implicit_flush', '1');
if (function_exists('apache_setenv')) { @apache_setenv('no-gzip','1'); @apache_setenv('dont-vary','1'); }
while (ob_get_level() > 0) { @ob_end_flush(); } ob_implicit_flush(true);
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache, no-transform'); header('Connection: keep-alive'); header('X-Accel-Buffering: no');
echo "retry: 2000\n"; echo ":" . str_repeat(" ", 2048) . "\n\n"; @flush();
$pdo = db(); $lastId = isset($_GET['last_id']) ? max(0, (int)$_GET['last_id']) : 0; $lastPing = microtime(true);
while (!connection_aborted()) {
  $stmt = $pdo->prepare('SELECT id,x,y,color,UNIX_TIMESTAMP(ts) AS t FROM pixel_events WHERE id > :id ORDER BY id ASC LIMIT 500');
  $stmt->execute([':id' => $lastId]); $rows = $stmt->fetchAll();
  if ($rows) {
    foreach ($rows as $r) {
      $payload = json_encode(['x'=>(int)$r['x'],'y'=>(int)$r['y'],'color'=>(int)$r['color'],'t'=>(int)$r['t'],'id'=>(int)$r['id']], JSON_UNESCAPED_UNICODE);
      echo "id: {$r['id']}\n"; echo "event: pixel\n"; echo "data: {$payload}\n\n"; $lastId = (int)$r['id'];
    } @flush(); $lastPing = microtime(true);
  } else {
    $now = microtime(true);
    if (($now - $lastPing) * 1000 >= SSE_HEARTBEAT_MS) { echo "event: ping\n"; echo "data: {\"t\":".time()."}\n\n"; @flush(); $lastPing = $now; }
    usleep(SSE_DB_POLL_MS * 1000);
  }
}
