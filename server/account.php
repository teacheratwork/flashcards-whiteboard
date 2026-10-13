<?php
/* A teacher's own account: change password, log out of every device. */
define('BBF', 1);
require __DIR__ . '/inc/core.php';
$me = require_user();

$msg = '';
$err = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    if (post('action') === 'password') {
        $old = isset($_POST['old']) ? (string)$_POST['old'] : '';
        $new = isset($_POST['new']) ? (string)$_POST['new'] : '';
        if (!password_verify($old, $me['hash'])) $err = 'La password attuale non è corretta.';
        elseif (strlen($new) < (int)cfg('min_password')) $err = 'La nuova password deve avere almeno ' . (int)cfg('min_password') . ' caratteri.';
        elseif ($new !== (isset($_POST['new2']) ? $_POST['new2'] : '')) $err = 'Le due password nuove non coincidono.';
        else {
            $uid = $me['uid'];
            $me = users_tx(function (&$users) use ($uid, $new) {
                $users[$uid]['hash'] = password_hash($new, PASSWORD_DEFAULT);
                $users[$uid]['sv']++;                    // other devices must log in again
                return $users[$uid];
            });
            login_cookie($me);
            log_event('password-own', $me['email']);
            $msg = 'Password cambiata. Sugli altri dispositivi dovrai accedere di nuovo.';
        }
    } elseif (post('action') === 'everywhere') {
        $uid = $me['uid'];
        $me = users_tx(function (&$users) use ($uid) { $users[$uid]['sv']++; return $users[$uid]; });
        login_cookie($me);
        log_event('logout-everywhere', $me['email']);
        $msg = 'Fatto: resti collegato solo su questo dispositivo.';
    }
}

$csrf = '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '">';
page('Il mio account', '<div class="card"><h1>' . h(cfg('app_name')) . '</h1>'
    . '<p class="sub">' . h($me['name']) . ' · ' . h($me['email'])
    . ($me['expires'] ? ' · accesso fino al ' . fmt_date($me['expires']) : '') . '</p>'
    . ($err ? '<div class="msg err">' . h($err) . '</div>' : ($msg ? '<div class="msg ok">' . h($msg) . '</div>' : ''))
    . '<a class="btn light" href="index.php">← Torna alla lavagna</a>'
    . ($me['role'] === 'admin' ? ' <a class="btn light" href="admin.php">Gestione accessi</a>' : '')
    . '</div>'
    . '<div class="card"><h2>Cambia la password</h2><form method="post">' . $csrf . '<input type="hidden" name="action" value="password">'
    . '<label>Password attuale</label><input type="password" name="old" required autocomplete="current-password">'
    . '<label>Nuova password</label><input type="password" name="new" required autocomplete="new-password">'
    . '<label>Ripeti la nuova password</label><input type="password" name="new2" required autocomplete="new-password">'
    . '<button>Cambia la password</button></form></div>'
    . '<div class="card"><h2>Esci dagli altri dispositivi</h2>'
    . '<p class="sub">Utile se hai usato la lavagna su un computer non tuo.</p>'
    . '<form method="post">' . $csrf . '<input type="hidden" name="action" value="everywhere">'
    . '<button class="light">Esci dagli altri dispositivi</button></form></div>');
