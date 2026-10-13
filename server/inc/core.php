<?php
/* BB1 flashcards — PHP host: accounts, login cookie, signed student links.

   Plain PHP (>= 7.4), no database, no WordPress: everything lives in this
   folder, uploaded by FTP. Data files are JSON behind a "<?php exit; ?>" line,
   so they show nothing even where .htaccess is ignored (nginx). */
defined('BBF') or exit;

define('BBF_DIR', dirname(__DIR__));
define('BBF_GUARD', "<?php exit; ?>\n");

$BBF_CFG = array(
    'app_name'           => 'BB1 flashcards',
    'setup_code'         => '',          // required to create the first admin
    'data_dir'           => BBF_DIR . '/data',
    'timezone'           => 'Europe/Rome',
    'login_days'         => 30,          // how long a login lasts on a device
    'student_link_hours' => 0,           // 0 = student links last until midnight
    'max_fails'          => 5,           // wrong passwords before a lock-out
    'lock_minutes'       => 10,
    'min_password'       => 8,
    'feedback_to'        => '',          // where teachers' reports are mailed ('' = only saved)
    'feedback_from'      => '',          // sender address; '' = noreply@<this site>
    'feedback_per_day'   => 20,          // reports per teacher per day
);
if (is_file(BBF_DIR . '/config.php')) {
    $c = include BBF_DIR . '/config.php';
    if (is_array($c)) $BBF_CFG = array_merge($BBF_CFG, $c);
}
// Local test server only (tools/serve_local.py): keeps test accounts out of
// the folder that gets uploaded.
if (getenv('BBF_DATA_DIR')) $BBF_CFG['data_dir'] = getenv('BBF_DATA_DIR');
date_default_timezone_set($BBF_CFG['timezone']);

function cfg($k) { global $BBF_CFG; return $BBF_CFG[$k]; }
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function post($k, $d = '') { return isset($_POST[$k]) ? trim((string)$_POST[$k]) : $d; }

/* ---------- storage: guarded JSON files ---------- */

function data_path($name) { return rtrim(cfg('data_dir'), '/\\') . '/' . $name; }

function ensure_data_dir() {
    $d = cfg('data_dir');
    if (!is_dir($d) && !@mkdir($d, 0750, true)) fail_page('La cartella dei dati non esiste e non si può creare: ' . $d);
    if (!is_writable($d)) fail_page('La cartella dei dati non è scrivibile: ' . $d . ' (permessi FTP 755 o 775).');
}

function read_guarded($name, $default) {
    $f = data_path($name);
    if (!is_file($f)) return $default;
    $s = @file_get_contents($f);
    if ($s === false) return $default;
    if (strpos($s, BBF_GUARD) === 0) $s = substr($s, strlen(BBF_GUARD));
    $v = json_decode($s, true);
    return $v === null ? $default : $v;
}

function write_guarded($name, $value) {
    $f = data_path($name);
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp.php';
    $json = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (@file_put_contents($tmp, BBF_GUARD . $json) === false || !@rename($tmp, $f)) {
        @unlink($tmp);
        fail_page('Impossibile salvare ' . $name . ' nella cartella dei dati.');
    }
}

function secret() {
    static $s = null;
    if ($s !== null) return $s;
    $v = read_guarded('secret.php', null);
    if (!is_string($v) || strlen($v) < 32) {
        ensure_data_dir();
        $v = bin2hex(random_bytes(32));
        write_guarded('secret.php', $v);
    }
    return $s = $v;
}

/* ---------- users ---------- */

function users_all() {
    $db = read_guarded('users.php', array('users' => array()));
    return isset($db['users']) && is_array($db['users']) ? $db['users'] : array();
}

// Read-modify-write under an exclusive lock. $fn receives the users array by
// reference; whatever it returns is returned.
function users_tx($fn) {
    ensure_data_dir();
    $lk = fopen(data_path('users.lock'), 'c');
    if (!$lk || !flock($lk, LOCK_EX)) fail_page('Impossibile bloccare il file utenti.');
    $users = users_all();
    $res = $fn($users);
    write_guarded('users.php', array('users' => $users));
    flock($lk, LOCK_UN);
    fclose($lk);
    return $res;
}

function find_by_email($users, $email) {
    foreach ($users as $u) if ($u['email'] === $email) return $u;
    return null;
}

function norm_email($e) { return strtolower(trim((string)$e)); }
function valid_email($e) { return (bool)filter_var($e, FILTER_VALIDATE_EMAIL); }
function valid_date($d) { return $d === '' || (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $d); }

function new_user($email, $name, $role, $expires, $password) {
    return array(
        'uid' => bin2hex(random_bytes(4)), 'email' => $email, 'name' => $name,
        'role' => $role === 'admin' ? 'admin' : 'teacher', 'active' => true,
        'expires' => $expires, 'hash' => password_hash($password, PASSWORD_DEFAULT),
        'sv' => 1, 'created' => date('c'), 'last_login' => null, 'logins' => 0,
        'fails' => 0, 'lock_until' => 0, 'student_opens' => 0, 'last_student_open' => null,
    );
}

// Disabled accounts and accounts past their expiry date cannot enter.
function user_can_enter($u) {
    if (empty($u['active'])) return false;
    return empty($u['expires']) || date('Y-m-d') <= $u['expires'];
}

// Readable random password: no 0/O, 1/l/I.
function random_password($len = 10) {
    $alpha = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $p = '';
    for ($i = 0; $i < $len; $i++) $p .= $alpha[random_int(0, strlen($alpha) - 1)];
    return $p;
}

/* ---------- log (one guarded file per month) ---------- */

function log_event($event, $email = '', $extra = '') {
    $f = data_path('log-' . date('Y-m') . '.php');
    $line = date('c') . "\t" . $event . "\t" . str_replace(array("\t", "\n"), ' ', $email . "\t" . $extra) . "\n";
    if (!is_file($f)) @file_put_contents($f, BBF_GUARD, LOCK_EX);
    @file_put_contents($f, $line, FILE_APPEND | LOCK_EX);
}

function log_tail($n) {
    $f = data_path('log-' . date('Y-m') . '.php');
    $lines = is_file($f) ? file($f, FILE_IGNORE_NEW_LINES) : array();
    if ($lines && strpos($lines[0], '<?php') === 0) array_shift($lines);
    return array_reverse(array_slice($lines, -$n));
}

/* ---------- teachers' reports (bugs, change requests) ---------- */

function feedback_all() {
    $f = read_guarded('feedback.php', array());
    return is_array($f) ? $f : array();
}

// Saves the report, then tries to mail it. Returns the saved entry, or an
// error message. Saving comes first: on shared hosting PHP mail() is often
// filtered or disabled, and the report must not get lost.
function feedback_add($u, $type, $text, $ctx) {
    $type = $type === 'change' ? 'change' : 'bug';
    $text = trim(mb_substr_safe((string)$text, 5000));
    if ($text === '') return 'Scrivi che cosa è successo o che cosa vorresti.';
    $ctx = is_array($ctx) ? $ctx : array();
    $clean = array();
    foreach (array('ua', 'screen', 'mode', 'cards', 'level') as $k) {
        if (isset($ctx[$k])) $clean[$k] = mb_substr_safe((string)$ctx[$k], 300);
    }
    ensure_data_dir();
    $lk = fopen(data_path('feedback.lock'), 'c');
    flock($lk, LOCK_EX);
    $all = feedback_all();
    $today = 0;
    foreach ($all as $f) if ($f['uid'] === $u['uid'] && substr($f['date'], 0, 10) === date('Y-m-d')) $today++;
    if ($today >= (int)cfg('feedback_per_day')) { flock($lk, LOCK_UN); fclose($lk); return 'Hai già inviato molte segnalazioni oggi: riprova domani.'; }
    $entry = array('id' => bin2hex(random_bytes(4)), 'date' => date('c'), 'uid' => $u['uid'], 'name' => $u['name'],
                   'email' => $u['email'], 'type' => $type, 'text' => $text, 'ctx' => $clean, 'mailed' => false);
    $all[] = $entry;
    write_guarded('feedback.php', $all);
    flock($lk, LOCK_UN);
    fclose($lk);
    log_event('feedback', $u['email'], $type === 'bug' ? 'problema' : 'richiesta di modifica');

    if (feedback_mail($entry)) {
        $lk = fopen(data_path('feedback.lock'), 'c');
        flock($lk, LOCK_EX);
        $all = feedback_all();
        foreach ($all as $i => $f) if ($f['id'] === $entry['id']) $all[$i]['mailed'] = true;
        write_guarded('feedback.php', $all);
        flock($lk, LOCK_UN);
        fclose($lk);
        $entry['mailed'] = true;
    }
    return $entry;
}

function feedback_mail($e) {
    $to = trim((string)cfg('feedback_to'));
    if ($to === '' || !function_exists('mail')) return false;
    $host = preg_replace('/^www\./', '', preg_replace('/:\d+$/', '', isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost'));
    $from = trim((string)cfg('feedback_from')) ?: 'noreply@' . $host;
    $kind = $e['type'] === 'bug' ? 'Problema' : 'Richiesta di modifica';
    $subject = '[' . cfg('app_name') . '] ' . $kind . ' da ' . $e['name'];
    $body = $kind . ' da ' . $e['name'] . ' <' . $e['email'] . '>, ' . fmt_date($e['date']) . "\n\n"
          . $e['text'] . "\n\n-- \n";
    foreach ($e['ctx'] as $k => $v) $body .= $k . ': ' . $v . "\n";
    $body .= "\nRispondi a questa mail per scrivere direttamente a " . $e['name'] . ".\n"
           . 'Tutte le segnalazioni: ' . app_url() . "admin.php\n";
    $reply = preg_replace('/[\r\n]/', '', $e['email']);
    $headers = 'From: ' . cfg('app_name') . ' <' . $from . ">\r\n"
             . 'Reply-To: ' . $reply . "\r\n"
             . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n";
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}

// mb_substr without requiring mbstring (often missing on cheap hosting).
function mb_substr_safe($s, $n) {
    if (function_exists('mb_substr')) return mb_substr($s, 0, $n, 'UTF-8');
    return preg_match('/^.{0,' . (int)$n . '}/us', $s, $m) ? $m[0] : substr($s, 0, $n);
}

/* ---------- signing ---------- */

function b64u($b) { return rtrim(strtr(base64_encode($b), '+/', '-_'), '='); }
function b64u_dec($s) { return (string)base64_decode(strtr($s, '-_', '+/')); }
function sign($msg, $len = 16) { return b64u(substr(hash_hmac('sha256', $msg, secret(), true), 0, $len)); }

/* ---------- login cookie: uid.sv.exp.sig ---------- */

function is_https() {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') return true;
    return isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443;
}

// The cookie stays inside this folder: the rest of the site never sees it.
function cookie_path() {
    return rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/') . '/';
}

function app_url() {
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
    return (is_https() ? 'https://' : 'http://') . $host . cookie_path();
}

function set_auth_cookie($val, $exp) {
    setcookie('bbf_auth', $val, array(
        'expires' => $exp, 'path' => cookie_path(), 'secure' => is_https(),
        'httponly' => true, 'samesite' => 'Lax',
    ));
    $_COOKIE['bbf_auth'] = $val;
}

function login_cookie($u) {
    $exp = time() + 86400 * (int)cfg('login_days');
    $payload = $u['uid'] . '.' . $u['sv'] . '.' . $exp;
    set_auth_cookie($payload . '.' . sign('auth|' . $payload), $exp);
}

function logout_cookie() { set_auth_cookie('', time() - 3600); }

function current_user() {
    static $cached = false;
    if ($cached !== false) return $cached;
    $cached = null;
    $c = isset($_COOKIE['bbf_auth']) ? (string)$_COOKIE['bbf_auth'] : '';
    $p = explode('.', $c);
    if (count($p) !== 4) return null;
    list($uid, $sv, $exp, $sig) = $p;
    if (!hash_equals(sign('auth|' . $uid . '.' . $sv . '.' . $exp), $sig) || (int)$exp < time()) return null;
    $users = users_all();
    if (!isset($users[$uid])) return null;
    $u = $users[$uid];
    if ((string)$u['sv'] !== $sv || !user_can_enter($u)) return null;
    return $cached = $u;
}

function require_user($admin = false) {
    $u = current_user();
    if (!$u) { header('Location: index.php'); exit; }
    if ($admin && $u['role'] !== 'admin') fail_page('Questa pagina è riservata agli amministratori.', 403);
    return $u;
}

function csrf_token() { return sign('csrf|' . (isset($_COOKIE['bbf_auth']) ? $_COOKIE['bbf_auth'] : ''), 12); }

function check_csrf() {
    $t = isset($_POST['csrf']) ? $_POST['csrf'] : (isset($_SERVER['HTTP_X_CSRF']) ? $_SERVER['HTTP_X_CSRF'] : '');
    if (!hash_equals(csrf_token(), (string)$t)) fail_page('Richiesta scaduta: ricarica la pagina e riprova.', 400);
}

/* ---------- password check with lock-out ---------- */

// Returns the user on success, or an error message.
function try_login($email, $password) {
    $email = norm_email($email);
    return users_tx(function (&$users) use ($email, $password) {
        $u = find_by_email($users, $email);
        if (!$u) {
            password_verify($password, password_hash('-', PASSWORD_DEFAULT));   // don't reveal unknown emails by timing
            log_event('login-unknown', $email);
            return 'Email o password non corretti.';
        }
        $id = $u['uid'];
        if ($u['lock_until'] > time()) {
            return 'Troppi tentativi sbagliati: riprova tra ' . ceil(($u['lock_until'] - time()) / 60) . ' minuti.';
        }
        if (!password_verify($password, $u['hash'])) {
            $users[$id]['fails'] = $u['fails'] + 1;
            if ($users[$id]['fails'] >= (int)cfg('max_fails')) {
                $users[$id]['lock_until'] = time() + 60 * (int)cfg('lock_minutes');
                $users[$id]['fails'] = 0;
                log_event('login-locked', $email);
            } else {
                log_event('login-fail', $email);
            }
            return 'Email o password non corretti.';
        }
        if (!user_can_enter($u)) {
            log_event('login-refused', $email, empty($u['active']) ? 'disattivato' : 'scaduto');
            return empty($u['active']) ? 'Questo account è disattivato.' : 'Questo account è scaduto il ' . fmt_date($u['expires']) . '.';
        }
        $users[$id]['fails'] = 0;
        $users[$id]['lock_until'] = 0;
        $users[$id]['last_login'] = date('c');
        $users[$id]['logins'] = $u['logins'] + 1;
        if (password_needs_rehash($u['hash'], PASSWORD_DEFAULT)) $users[$id]['hash'] = password_hash($password, PASSWORD_DEFAULT);
        log_event('login', $email);
        return $users[$id];
    });
}

/* ---------- student links: uid~exp~s~o~sig ---------- */

function student_link_expiry() {
    $hours = (int)cfg('student_link_hours');
    if ($hours > 0) return time() + 3600 * $hours;
    $d = new DateTime('tomorrow');
    return $d->getTimestamp() - 1;
}

function make_student_token($u, $s, $o) {
    if (!preg_match('/^1[A-Za-z0-9_-]{1,80}$/', $s) || !preg_match('/^1[0-9a-z]{1,3}\.[A-Za-z0-9_-]{0,40}$/', $o)) return null;
    $exp = student_link_expiry();
    $body = $u['uid'] . '~' . base_convert((string)$exp, 10, 36) . '~' . $s . '~' . $o;
    return array('token' => $body . '~' . sign('stu|' . $body, 12), 'exp' => $exp);
}

// Returns array(uid, exp, s, o) or an error code: invalid | expired | revoked.
function check_student_token($t) {
    $p = explode('~', (string)$t);
    if (count($p) !== 5) return 'invalid';
    $body = $p[0] . '~' . $p[1] . '~' . $p[2] . '~' . $p[3];
    if (!hash_equals(sign('stu|' . $body, 12), $p[4])) return 'invalid';
    $exp = (int)base_convert($p[1], 36, 10);
    if ($exp < time()) return 'expired';
    $users = users_all();
    if (!isset($users[$p[0]]) || !user_can_enter($users[$p[0]])) return 'revoked';
    return array($p[0], $exp, $p[2], $p[3]);
}

// Same bitmask as encodeSelection() in app.js, over the catalogue order.
function decode_selection($s, $ids) {
    $bytes = b64u_dec(substr($s, 1));
    $out = array();
    foreach ($ids as $i => $id) {
        $b = $i >> 3;
        if ($b < strlen($bytes) && ((ord($bytes[$b]) >> ($i & 7)) & 1)) $out[] = $id;
    }
    return $out;
}

/* ---------- the app page ---------- */

function load_cards() {
    $json = require __DIR__ . '/cards.php';      // generated by tools/build.py
    return json_decode($json, true);
}

function render_app($catalog, $cats, $server) {
    $f = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP;
    $data = 'window.CATS=' . json_encode($cats, $f) . ';window.CATALOG=' . json_encode($catalog, $f)
          . ';window.SERVER=' . json_encode($server, $f) . ';';
    $shell = require __DIR__ . '/shell.php';      // generated by tools/build.py
    send_headers();
    if (extension_loaded('zlib') && !ini_get('zlib.output_compression')) ob_start('ob_gzhandler');
    echo str_replace('/*__DATA__*/', $data, $shell);
    exit;
}

function send_headers() {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Frame-Options: SAMEORIGIN');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow');
}

/* ---------- plain pages (login, admin, messages) ---------- */

function fmt_date($iso) {
    if (!$iso) return '—';
    $t = strtotime($iso);
    return $t ? date(strlen($iso) > 10 ? 'd/m/Y H:i' : 'd/m/Y', $t) : '—';
}

function page($title, $body, $wide = false) {
    send_headers();
    $css = <<<'CSS'
:root { --bg:#f4f6f9; --card:#fff; --ink:#1b2733; --muted:#5d6b7a; --line:#d9e0e7; --accent:#1e6fd9; --bad:#c62828; --ok:#1c7c3c; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
main { max-width:420px; margin:6vh auto; padding:0 16px; }
main.wide { max-width:1100px; margin:24px auto; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:16px; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:0 0 12px; }
.sub { color:var(--muted); margin:0 0 18px; }
label { display:block; font-weight:600; margin:12px 0 4px; font-size:14px; }
input[type=email], input[type=text], input[type=password], input[type=date], select {
  width:100%; padding:10px 12px; font:inherit; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); }
.inline { display:flex; gap:14px; flex-wrap:wrap; font-weight:400; }
.inline label { display:flex; gap:6px; align-items:center; font-weight:400; margin:6px 0; }
button, .btn { display:inline-block; padding:9px 16px; font:inherit; font-weight:600; border-radius:8px; border:1px solid var(--accent);
  background:var(--accent); color:#fff; cursor:pointer; text-decoration:none; margin-top:14px; }
button.light, .btn.light { background:#fff; color:var(--accent); }
button.small { padding:5px 10px; font-size:13px; margin:2px 0; }
button.danger { background:#fff; color:var(--bad); border-color:#e8b4b4; }
.msg { padding:10px 12px; border-radius:8px; margin-bottom:14px; }
.msg.err { background:#fdecec; color:var(--bad); } .msg.ok { background:#e8f5ec; color:var(--ok); }
.top { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
.top a { color:var(--accent); font-weight:600; text-decoration:none; margin-left:14px; }
.tbl { width:100%; overflow-x:auto; }
table { border-collapse:collapse; width:100%; font-size:14px; }
th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
tr.off td { color:var(--muted); }
.tag { display:inline-block; font-size:12px; padding:1px 7px; border-radius:10px; background:#eef2f6; }
.tag.admin { background:#e6effc; color:var(--accent); } .tag.bad { background:#fdecec; color:var(--bad); }
details summary { cursor:pointer; color:var(--accent); font-weight:600; font-size:13px; }
details form { margin:8px 0; padding:8px; background:#f8fafc; border-radius:8px; }
pre.share { white-space:pre-wrap; background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:12px; font:14px/1.5 ui-monospace,Consolas,monospace; }
.log { font:12px/1.5 ui-monospace,Consolas,monospace; color:var(--muted); max-height:320px; overflow:auto; white-space:pre; }
.report { border-top:1px solid var(--line); padding:12px 0; }
.report-head { font-size:14px; } .report-head a { color:var(--accent); }
.report-text { white-space:pre-wrap; margin:6px 0; }
.report-ctx { font-size:12px; color:var(--muted); word-break:break-all; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
@media (max-width:640px) { .grid2 { grid-template-columns:1fr; } }
CSS;
    echo '<!doctype html><html lang="it"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1">'
       . '<meta name="robots" content="noindex, nofollow">'
       . '<title>' . h($title) . ' · ' . h(cfg('app_name')) . '</title><style>' . $css . '</style></head>'
       . '<body><main' . ($wide ? ' class="wide"' : '') . '>' . $body . '</main></body></html>';
    exit;
}

function fail_page($msg, $code = 500) {
    http_response_code($code);
    page('Errore', '<div class="card"><h1>' . h(cfg('app_name')) . '</h1><div class="msg err">' . h($msg) . '</div>'
        . '<a class="btn light" href="index.php">Torna all\'inizio</a></div>');
}
