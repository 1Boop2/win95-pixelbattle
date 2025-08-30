<?php
declare(strict_types=1);
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/utils.php';
$pdo = db();
$last = (int)($pdo->query('SELECT IFNULL(MAX(id),0) AS id FROM pixel_events')->fetch()['id'] ?? 0);
$snapDir = __DIR__ . '/../../snapshots'; $snapPng = $snapDir . '/latest.png';
if (is_file($snapPng)) { header('Content-Type: image/png'); header('X-Last-Event-Id: ' . $last); header('Cache-Control: no-cache, no-transform'); readfile($snapPng); exit; }
$img = imagecreatetruecolor(CANVAS_W, CANVAS_H); imagealphablending($img, true); imagesavealpha($img, false);
$paletteIdx = []; foreach (PALETTE as $hex) { $r=hexdec(substr($hex,1,2)); $g=hexdec(substr($hex,3,2)); $b=hexdec(substr($hex,5,2)); $paletteIdx[] = imagecolorallocate($img,$r,$g,$b); }
imagefill($img, 0, 0, $paletteIdx[15]);
$stmt = $pdo->query('SELECT x,y,color FROM pixels'); while ($p = $stmt->fetch()) { imagesetpixel($img, (int)$p['x'], (int)$p['y'], $paletteIdx[(int)$p['color']]); }
header('Content-Type: image/png'); header('X-Last-Event-Id: ' . $last); header('Cache-Control: no-cache, no-transform'); imagepng($img); imagedestroy($img);
