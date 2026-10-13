<?php
/* Account management, for administrators only (Italian UI: the publisher
   manages the accounts). A new or reset password is shown once, with a
   ready-to-send message; only its hash is stored. */
define('BBF', 1);
require __DIR__ . '/inc/core.php';
$me = require_user(true);

$msg = '';
$err = '';
$shown = null;      // array(user, password) to show once

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $action = post('action');
    $uid = post('uid');
    $minpw = (int)cfg('min_password');
    // a password chosen by the admin, or a random one
    $pick = function () use ($minpw, &$err) {
        if (post('pwmode') !== 'custom') return random_password();
        $p = isset($_POST['password']) ? (string)$_POST['password'] : '';
        if (strlen($p) < $minpw) { $err = 'La password deve avere almeno ' . $minpw . ' caratteri.'; return null; }
        return $p;
    };

    if ($action === 'create') {
        $email = norm_email(post('email'));
        $name = post('name');
        $expires = post('expires');
        if (!valid_email($email)) $err = 'Email non valida.';
        elseif ($name === '') $err = 'Scrivi il nome.';
        elseif (!valid_date($expires)) $err = 'Data di scadenza non valida.';
        elseif (($pw = $pick()) !== null) {
            $u = users_tx(function (&$users) use ($email, $name, $expires, $pw) {
                if (find_by_email($users, $email)) return null;
                $u = new_user($email, $name, post('role'), $expires, $pw);
                $users[$u['uid']] = $u;
                return $u;
            });
            if (!$u) $err = 'Esiste già un account con questa email.';
            else { log_event('admin-create', $email, 'da ' . $me['email']); $shown = array($u, $pw); $msg = 'Account creato.'; }
        }
    } elseif ($action === 'password') {
        if (($pw = $pick()) !== null) {
            $u = users_tx(function (&$users) use ($uid, $pw) {
                if (!isset($users[$uid])) return null;
                $users[$uid]['hash'] = password_hash($pw, PASSWORD_DEFAULT);
                $users[$uid]['sv']++;                 // logs out every device
                $users[$uid]['fails'] = 0;
                $users[$uid]['lock_until'] = 0;
                return $users[$uid];
            });
            if ($u) {
                log_event('admin-password', $u['email'], 'da ' . $me['email']);
                if ($uid === $me['uid']) login_cookie($u);    // stay logged in here
                $shown = array($u, $pw);
                $msg = 'Password cambiata.';
            }
        }
    } elseif ($action === 'edit') {
        $name = post('name');
        $expires = post('expires');
        if ($name === '') $err = 'Il nome non può essere vuoto.';
        elseif (!valid_date($expires)) $err = 'Data di scadenza non valida.';
        else {
            $role = post('role') === 'admin' ? 'admin' : 'teacher';
            if ($uid === $me['uid']) $role = 'admin';            // never demote yourself
            $u = users_tx(function (&$users) use ($uid, $name, $expires, $role) {
                if (!isset($users[$uid])) return null;
                $users[$uid]['name'] = $name;
                $users[$uid]['expires'] = $expires;
                $users[$uid]['role'] = $role;
                return $users[$uid];
            });
            if ($u) { log_event('admin-edit', $u['email'], 'da ' . $me['email']); $msg = 'Modifiche salvate.'; }
        }
    } elseif ($action === 'toggle' && $uid !== $me['uid']) {
        $u = users_tx(function (&$users) use ($uid) {
            if (!isset($users[$uid])) return null;
            $users[$uid]['active'] = empty($users[$uid]['active']);
            $users[$uid]['sv']++;
            return $users[$uid];
        });
        if ($u) {
            log_event($u['active'] ? 'admin-enable' : 'admin-disable', $u['email'], 'da ' . $me['email']);
            $msg = $u['active'] ? 'Account riattivato.' : 'Account disattivato: l\'accesso e i link per gli alunni smettono di funzionare subito.';
        }
    } elseif ($action === 'fbdelete') {
        $fid = post('fid');
        ensure_data_dir();
        $lk = fopen(data_path('feedback.lock'), 'c');
        flock($lk, LOCK_EX);
        $all = array_values(array_filter(feedback_all(), function ($f) use ($fid) { return $f['id'] !== $fid; }));
        write_guarded('feedback.php', $all);
        flock($lk, LOCK_UN);
        fclose($lk);
        $msg = 'Segnalazione eliminata.';
    } elseif ($action === 'delete' && $uid !== $me['uid']) {
        $email = users_tx(function (&$users) use ($uid) {
            if (!isset($users[$uid])) return null;
            $e = $users[$uid]['email'];
            unset($users[$uid]);
            return $e;
        });
        if ($email) { log_event('admin-delete', $email, 'da ' . $me['email']); $msg = 'Account eliminato.'; }
    }
}

$users = users_all();
uasort($users, function ($a, $b) { return strcasecmp($a['name'], $b['name']); });
$csrf = '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '">';

function status_tag($u) {
    if (empty($u['active'])) return '<span class="tag bad">disattivato</span>';
    if (!user_can_enter($u)) return '<span class="tag bad">scaduto</span>';
    return '<span class="tag">attivo</span>';
}

function pw_fields() {
    return '<div class="inline"><label><input type="radio" name="pwmode" value="random" checked> casuale</label>'
         . '<label><input type="radio" name="pwmode" value="custom"> scelta da me:</label></div>'
         . '<input type="text" name="password" autocomplete="off" placeholder="solo se «scelta da me»">';
}

$out = '<div class="top"><div><h1>' . h(cfg('app_name')) . '</h1><span class="sub">Gestione degli accessi</span></div>'
     . '<div><a href="index.php">Apri la lavagna</a><a href="#segnalazioni">Segnalazioni (' . count(feedback_all()) . ')</a><a href="account.php">Il mio account</a>'
     . '<a href="index.php?logout=' . h(csrf_token()) . '">Esci</a></div></div>';

if ($err) $out .= '<div class="msg err">' . h($err) . '</div>';
elseif ($msg) $out .= '<div class="msg ok">' . h($msg) . '</div>';

if ($shown) {
    list($su, $spw) = $shown;
    $text = "Ciao " . $su['name'] . ", ecco il tuo accesso a " . cfg('app_name') . ":\n"
          . "Indirizzo: " . app_url() . "\n"
          . "Email: " . $su['email'] . "\n"
          . "Password: " . $spw . "\n"
          . "Puoi cambiare la password da «Account», in alto nella lavagna.";
    $out .= '<div class="card"><h2>Da inviare a ' . h($su['name']) . '</h2>'
          . '<p class="sub">La password si vede solo adesso: copiala prima di lasciare la pagina.</p>'
          . '<pre class="share" id="shareText">' . h($text) . '</pre>'
          . '<button type="button" onclick="navigator.clipboard.writeText(document.getElementById(\'shareText\').textContent).then(function(){this.textContent=\'Copiato!\'}.bind(this))">Copia il messaggio</button></div>';
}

/* ---------- new account ---------- */
$out .= '<div class="card"><h2>Nuovo account</h2><form method="post">' . $csrf . '<input type="hidden" name="action" value="create">'
      . '<div class="grid2"><div><label>Nome e cognome</label><input type="text" name="name" required></div>'
      . '<div><label>Email</label><input type="email" name="email" required></div>'
      . '<div><label>Ruolo</label><select name="role"><option value="teacher">docente</option><option value="admin">amministratore</option></select></div>'
      . '<div><label>Scadenza (facoltativa)</label><input type="date" name="expires"></div></div>'
      . '<label>Password</label>' . pw_fields()
      . '<button>Crea l\'account</button></form></div>';

/* ---------- accounts ---------- */
$out .= '<div class="card"><h2>Account (' . count($users) . ')</h2><div class="tbl"><table>'
      . '<tr><th>Nome</th><th>Email</th><th>Stato</th><th>Scadenza</th><th>Ultimo accesso</th><th>Accessi</th><th>Aperture alunni</th><th></th></tr>';
foreach ($users as $u) {
    $self = $u['uid'] === $me['uid'];
    $id = '<input type="hidden" name="uid" value="' . h($u['uid']) . '">';
    $out .= '<tr' . (user_can_enter($u) ? '' : ' class="off"') . '>'
          . '<td>' . h($u['name']) . ($u['role'] === 'admin' ? ' <span class="tag admin">amministratore</span>' : '') . '</td>'
          . '<td>' . h($u['email']) . '</td>'
          . '<td>' . status_tag($u) . '</td>'
          . '<td>' . fmt_date($u['expires']) . '</td>'
          . '<td>' . fmt_date($u['last_login']) . '</td>'
          . '<td>' . (int)$u['logins'] . '</td>'
          . '<td>' . (int)$u['student_opens'] . '</td><td>'
          . '<details><summary>Modifica</summary>'
          . '<form method="post">' . $csrf . $id . '<input type="hidden" name="action" value="edit">'
          . '<label>Nome</label><input type="text" name="name" value="' . h($u['name']) . '">'
          . '<label>Scadenza</label><input type="date" name="expires" value="' . h($u['expires']) . '">'
          . ($self ? '' : '<label>Ruolo</label><select name="role"><option value="teacher">docente</option><option value="admin"'
                        . ($u['role'] === 'admin' ? ' selected' : '') . '>amministratore</option></select>')
          . '<button class="small">Salva</button></form>'
          . '<form method="post">' . $csrf . $id . '<input type="hidden" name="action" value="password">'
          . '<label>Nuova password</label>' . pw_fields() . '<button class="small">Cambia la password</button></form>'
          . ($self ? '' :
              '<form method="post">' . $csrf . $id . '<input type="hidden" name="action" value="toggle">'
            . '<button class="small light">' . (empty($u['active']) ? 'Riattiva' : 'Disattiva') . '</button></form>'
            . '<form method="post" onsubmit="return confirm(\'Eliminare definitivamente ' . h(addslashes($u['email'])) . '?\')">'
            . $csrf . $id . '<input type="hidden" name="action" value="delete"><button class="small danger">Elimina</button></form>')
          . '</details></td></tr>';
}
$out .= '</table></div></div>';

/* ---------- teachers' reports ---------- */
$reports = array_reverse(feedback_all());
$out .= '<div class="card" id="segnalazioni"><h2>Segnalazioni dei docenti (' . count($reports) . ')</h2>';
if (!$reports) $out .= '<p class="sub">Nessuna segnalazione. I docenti le mandano dalla lavagna con «Segnala».</p>';
foreach ($reports as $f) {
    $ctx = array();
    foreach ($f['ctx'] as $k => $v) $ctx[] = $k . ': ' . $v;
    $out .= '<div class="report">'
          . '<div class="report-head"><span class="tag' . ($f['type'] === 'bug' ? ' bad' : ' admin') . '">'
          . ($f['type'] === 'bug' ? 'problema' : 'richiesta di modifica') . '</span> '
          . '<b>' . h($f['name']) . '</b> · <a href="mailto:' . h($f['email']) . '">' . h($f['email']) . '</a> · '
          . fmt_date($f['date']) . ($f['mailed'] ? ' · inviata per email' : '') . '</div>'
          . '<div class="report-text">' . h($f['text']) . '</div>'
          . ($ctx ? '<div class="report-ctx">' . h(implode(' · ', $ctx)) . '</div>' : '')
          . '<form method="post" onsubmit="return confirm(\'Eliminare questa segnalazione?\')">' . $csrf
          . '<input type="hidden" name="action" value="fbdelete"><input type="hidden" name="fid" value="' . h($f['id']) . '">'
          . '<button class="small danger">Elimina</button></form></div>';
}
$out .= '</div>';

/* ---------- log ---------- */
$labels = array(
    'setup' => 'installazione', 'login' => 'accesso', 'logout' => 'uscita',
    'login-fail' => 'password sbagliata', 'login-unknown' => 'email sconosciuta',
    'login-locked' => 'bloccato per troppi tentativi', 'login-refused' => 'accesso rifiutato',
    'password-own' => 'ha cambiato la propria password', 'logout-everywhere' => 'uscito dagli altri dispositivi',
    'admin-create' => 'account creato', 'admin-password' => 'password cambiata', 'admin-edit' => 'account modificato',
    'feedback' => 'segnalazione', 'admin-enable' => 'account riattivato', 'admin-disable' => 'account disattivato', 'admin-delete' => 'account eliminato',
);
$rows = array();
foreach (log_tail(200) as $line) {
    $p = explode("\t", $line);
    if (count($p) < 3) continue;
    $rows[] = fmt_date($p[0]) . '   ' . (isset($labels[$p[1]]) ? $labels[$p[1]] : $p[1]) . '   ' . $p[2]
            . (isset($p[3]) && $p[3] !== '' ? ' (' . $p[3] . ')' : '');
}
$out .= '<div class="card"><h2>Registro di questo mese</h2><div class="log">'
      . h($rows ? implode("\n", $rows) : 'Nessun evento.') . '</div></div>';

page('Gestione accessi', $out, true);
