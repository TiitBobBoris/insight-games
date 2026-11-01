<?php
// Pesa jooniste allalaadimine. Link kliendi kirjas: joonised-dl.php?o=<tellimuse allalaadimistunnus>.
// Tellimust kontrollib Supabase'i funktsioon pesa-drawings (?a=check); failid on kaustas _joonised,
// kuhu otse ligi ei pääse (.htaccess). Link sulgub alles pärast lõpuni jõudnud allalaadimist (?a=consumed).
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
