<?php
// Pesa jooniste allalaadimine. Link kliendi kirjas: joonised-dl.php?o=<tellimuse allalaadimistunnus>.
// Tellimust kontrollib Supabase'i funktsioon pesa-drawings (?a=check); failid on kaustas _joonised,
// kuhu otse ligi ei pääse (.htaccess). Link sulgub alles pärast lõpuni jõudnud allalaadimist (?a=consumed).
// joonised-dl.php?a=import: võtab funktsioonist ühe pakkimistöö (Dropboxi ajutised lingid), pakib ZIP-iks _joonised alla.
// Funktsioon annab töö ainult selle serveri IP-lt.
$FN = 'https://xlhtavzsanlikmxrddrb.supabase.co/functions/v1/pesa-drawings';

function fail($code, $msg) {
  http_response_code($code);
  header('Content-Type: text/plain; charset=utf-8');
  exit($msg . "\n\nKüsimused: tiit@sportsport.ee, +372 5560 1425\n");
}
function get_url($url) {
  if (function_exists('curl_init')) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
    $r = curl_exec($c); curl_close($c); return $r;
  }
  return @file_get_contents($url);
}
function post_json($url, $data) {
  $c = curl_init($url);
  curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_POSTFIELDS => json_encode($data)]);
  $r = curl_exec($c); curl_close($c); return $r;
}

$DIR = __DIR__ . '/_joonised';
if (!is_dir($DIR)) @mkdir($DIR, 0755, true);
if (!is_file("$DIR/.htaccess")) @file_put_contents("$DIR/.htaccess", "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");

if (isset($_GET['a']) && $_GET['a'] === 'import') {
  header('Content-Type: text/plain; charset=utf-8');
  @set_time_limit(0);
  ignore_user_abort(true);
  $r = json_decode((string) get_url("$FN?a=import_job"), true);
  if (!$r || empty($r['job'])) exit('Töid pole: ' . json_encode($r));
  $job = $r['job'];
  if (!preg_match('#^PESA-([1-4])/(89-7|109-7|123-4)\.zip$#', $job['zip'], $m)) exit('Vale nimi.');
  $root = "PESA-{$m[1]}_{$m[2]}";
  $tmp = "$DIR/tmp-" . intval($job['id']);
  @mkdir($tmp, 0755, true);
  @mkdir(dirname("$DIR/{$job['zip']}"), 0755, true);
  $part = "$DIR/{$job['zip']}.part";
  $za = new ZipArchive();
  if ($za->open($part, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) exit('ZIP ei avane.');
  $log = []; $ok = true; $i = 0;
  foreach ($job['files'] as $f) {
    $name = $f['name'];
    if (strpos($name, '..') !== false || !preg_match('#^[\w .()/-]+$#u', $name)) { $ok = false; $log[] = "vale failinimi $name"; continue; }
    $local = "$tmp/" . ($i++);
    $fh = fopen($local, 'wb');
    $c = curl_init($f['url']);
    curl_setopt_array($c, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 900, CURLOPT_FAILONERROR => true]);
    $res = curl_exec($c); $err = curl_error($c); curl_close($c); fclose($fh);
    if (!$res || filesize($local) === 0) { $ok = false; $log[] = "$name: $err"; continue; }
    $za->addFile($local, "$root/$name");
    if (preg_match('/\.(pla|zip|jpg|png)$/i', $name) && method_exists($za, 'setCompressionName')) $za->setCompressionName("$root/$name", ZipArchive::CM_STORE);
    $log[] = "$name " . round(filesize($local) / 1048576, 1) . ' MB';
  }
  if (!empty($job['readme'])) $za->addFromString("$root/LOEMIND.txt", $job['readme']);
  $za->close();
  array_map('unlink', glob("$tmp/*")); @rmdir($tmp);
  if ($ok) rename($part, "$DIR/{$job['zip']}"); else @unlink($part);
  $size = $ok ? round(filesize("$DIR/{$job['zip']}") / 1048576, 1) . ' MB' : '';
  $result = ($ok ? "OK {$job['zip']} $size" : "VIGA {$job['zip']}") . "\n" . implode("\n", $log);
  post_json("$FN?a=import_done", ['id' => $job['id'], 'result' => $result]);
  exit($result);
}

$o = isset($_GET['o']) ? $_GET['o'] : '';
if (!preg_match('/^[0-9a-f]{36}$/', $o)) fail(400, 'Vigane allalaadimislink.');
$r = json_decode((string) get_url("$FN?a=check&o=$o"), true);
if (empty($r['ok'])) fail(410, isset($r['message']) ? $r['message'] : 'Link ei kehti.');
if (!preg_match('#^PESA-[1-4]/(89-7|109-7|123-4)\.zip$#', $r['file'])) fail(404, 'Faili ei leitud.');
$path = __DIR__ . '/_joonised/' . $r['file'];
if (!is_file($path)) fail(404, 'Failid on veel ettevalmistamisel. Saadame lingi e-postile ühe tööpäeva jooksul.');

$size = filesize($path);
ignore_user_abort(true);
@set_time_limit(0);
while (ob_get_level()) ob_end_clean();
header('Content-Type: application/zip');
header('Content-Length: ' . $size);
header('Content-Disposition: attachment; filename="' . $r['name'] . '"');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$fh = fopen($path, 'rb');
$sent = 0;
while (!feof($fh)) {
  $buf = fread($fh, 1048576);
  echo $buf; flush();
  $sent += strlen($buf);
  if (connection_aborted()) break;
}
fclose($fh);
if (!connection_aborted() && $sent === $size) get_url("$FN?a=consumed&o=$o");
