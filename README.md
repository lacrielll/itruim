# Itruim

**Iterate. Run. Improve.**

[Русский](#русский) · [English](#english)

## Русский

Itruim — self-hosted учебная платформа для квизов после лекций и проверки заданий по программированию.

Проект появился из двух практических задач:

- проводить короткие квизы после лекций и награждать студентов медалями;
- помогать преподавателю проверять код с помощью воспроизводимых автотестов, анализа и LLM, сохраняя итоговое решение за человеком.

### Что здесь можно делать

- создавать и публиковать версионируемые квизы, ограничивать доступ по курсам и группам;
- проводить до двух попыток, автоматически оценивать ответы и выдавать медали;
- публиковать лабораторные, принимать решения и хранить историю отправок;
- запускать детерминированную проверку кода в отдельном изолированном grader worker;
- собирать evidence, запрашивать у студента пояснения и формировать рекомендацию по оценке через LLM;
- проверять работы преподавателем, назначать ручную защиту и выдавать достижения;
- вести кабинеты администратора, преподавателя и студента, табели и уведомления.

### Пайп проверки кода

Проверка строится из последовательных этапов:

1. валидация структуры решения и контрактов;
2. статические и AST-проверки;
3. unit-, integration- и end-to-end-тесты;
4. запуск с лимитами CPU, RAM, времени и процессов;
5. сбор структурированных evidence: `critical`, `warning` и положительных решений;
6. опциональный LLM-review качества кода и вопросов студенту;
7. независимый assessment по evidence и передача результата преподавателю.

Для лабораторной настраиваются этапы и политика остановки, CPU/GPU runtime, образ среды, зависимости, ресурсы, контракты функций, приватный grader, тесты, критерии из 100 баллов, LLM-политика, число вопросов и связанные достижения. Критическая ошибка останавливает проверку до LLM; предупреждения и положительные evidence передаются дальше.

Платформа управляет заданиями и workflow, но не исполняет недоверенный код внутри Cloudflare Worker. Этим занимается отдельный grader worker в изолированной среде без сети. Конкретные grader-тесты лабораторных должны храниться в приватном репозитории.

### Состав проекта

- React-интерфейс и Hono API в Cloudflare Workers;
- Cloudflare D1 для состояния платформы;
- Backblaze B2 для изображений;
- отдельный [**Itruim grader worker**](https://github.com/lacrielll/itruim-grader-worker) для безопасного исполнения кода;
- подключаемые LLM-провайдеры для review и assessment.

### Документация

- [Запуск и развёртывание платформы](docs/getting-started.ru.md)
- [Itruim grader worker](https://github.com/lacrielll/itruim-grader-worker) содержит worker, [пример grader](https://github.com/lacrielll/itruim-grader-worker/tree/main/graders/lab1) и [демонстрационную лабораторную](https://github.com/lacrielll/itruim-grader-worker/tree/main/examples/lab1).

### TODO

- Перевести интерфейс платформы на английский и добавить переключение языка. Сейчас UI русскоязычный; английская версия README и инструкции по развёртыванию уже доступны.

## English

Itruim is a self-hosted learning platform for post-lecture quizzes and programming assignment assessment.

It was built to solve two practical problems:

- run short quizzes after lectures and reward students with medals;
- help instructors review code through reproducible tests, structured analysis, and LLM assistance while keeping the final decision human-controlled.

### What it supports

- versioned quizzes with course- and group-based access;
- up to two attempts, automatic scoring, and medals;
- coding assignments with submission history;
- deterministic code evaluation in a separate isolated grader worker;
- structured evidence, student clarification questions, and LLM-assisted assessment;
- instructor review, manual defenses, and achievements;
- administrator, instructor, and student workspaces, gradebooks, and notifications.

### Code-grading pipeline

A grading pipeline can contain:

1. solution layout and contract validation;
2. static and AST checks;
3. unit, integration, and end-to-end tests;
4. execution under CPU, memory, time, and process limits;
5. structured `critical`, `warning`, and positive evidence collection;
6. optional LLM code review and student questions;
7. evidence-only assessment followed by instructor review.

Each assignment can customize its stages and stop policies, CPU/GPU runtime, environment image, dependencies, resource limits, function contracts, private grader, tests, 100-point rubric, LLM policy, question limits, and linked achievements. Critical failures stop the pipeline before the LLM stage; warnings and positive evidence continue downstream.

The platform coordinates assignments and grading workflows but does not execute untrusted code inside Cloudflare Workers. A separate network-isolated grader worker performs that job. Private assignment tests should live in a private repository.

### Components

- React UI and Hono API on Cloudflare Workers;
- Cloudflare D1 for application state;
- Backblaze B2 for images;
- a separate [**Itruim grader worker**](https://github.com/lacrielll/itruim-grader-worker) for isolated code execution;
- pluggable LLM providers for review and assessment.

### Documentation

- [Platform setup and deployment](docs/getting-started.en.md)
- [Itruim grader worker](https://github.com/lacrielll/itruim-grader-worker) contains the worker, an [example grader](https://github.com/lacrielll/itruim-grader-worker/tree/main/graders/lab1), and a [demo assignment](https://github.com/lacrielll/itruim-grader-worker/tree/main/examples/lab1).

### TODO

- Translate the platform UI into English and add language switching. The current interface is in Russian; the English README and deployment guide are already available.

## License

Itruim is licensed under the [Apache License 2.0](LICENSE).
