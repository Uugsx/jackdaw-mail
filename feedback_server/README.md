# Сервис обратной связи Jackdaw Mail

Форма «Настройки → О программе → Обратная связь» отправляет `POST https://license.jackdaw-mail.pro/v1/feedback`.
Сервис (`feedback.py`, только стандартная библиотека Python) пересылает отзыв:

- **на почту** владельцу (SMTP, по умолчанию Resend `smtp.resend.com:2587`), с Reply-To на адрес пользователя;
- **в Telegram** — ботом в закрытую группу (простой текст, без разметки);
- **в GitHub** — issue, только для типа «Ошибка».

## Безопасность

- В приложении нет секретов. Токены и пароль SMTP — файлы в `/etc/jackdaw-feedback/` (0440, группа `jackdaw-feedback`).
- Отдельный системный пользователь `jackdaw-feedback` без доступа к базе лицензий; systemd-песочница (`ProtectSystem=strict`, `MemoryMax=128M` и др.).
- Слушает только `127.0.0.1:8092`, наружу — через Caddy (`handle /v1/feedback`).
- Тело ≤ 32 КБ, только `application/json`, белый список полей, вырезание управляющих символов, проверка email.
- Лимиты: 3 отзыва за 10 минут и 10 в сутки с одного IP, 300 в сутки всего; повтор того же текста в течение часа отбрасывается; поле-ловушка для ботов.
- В issue **нет** адреса для ответа и IP; текст пользователя — в блоке кода (упоминания `@` и ссылки не срабатывают), `@` в заголовке нейтрализуется.
- GitHub-токен — fine-grained, только на один репозиторий, права **Issues: Read and write**. Для публичного репозитория помните: описание ошибки будет видно всем.
- В журнал пишутся только номер отзыва, тип и результат доставки — без текста и адресов.

## Развёртывание

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin jackdaw-feedback
sudo install -d -o root -g jackdaw-feedback -m 0750 /opt/jackdaw-feedback /etc/jackdaw-feedback
sudo install -o root -g jackdaw-feedback -m 0644 feedback_server/feedback.py /opt/jackdaw-feedback/
sudo install -o root -g root -m 0600 feedback_server/deploy/feedback.env.example /etc/jackdaw-feedback/feedback.env
# секреты: smtp.secret, telegram.secret, github.secret — root:jackdaw-feedback 0440
sudo install -m 0644 feedback_server/systemd/jackdaw-feedback.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now jackdaw-feedback
```

Caddy, в блоке `license.jackdaw-mail.pro`:

```
handle /v1/feedback {
    reverse_proxy 127.0.0.1:8092
}
```

Каналы необязательны: без настроек канал просто пропускается (видно в журнале `journalctl -u jackdaw-feedback`).

## Проверка

```bash
python3 -m unittest discover -s feedback_server/tests -v
```
