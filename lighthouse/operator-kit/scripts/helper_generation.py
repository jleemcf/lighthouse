import json
import errno
import os
import re
import time

_last_good = {}


def _json(filename):
    with open(filename, encoding='utf-8') as source:
        return json.load(source)


def _read(load, previous):
    try:
        return load()
    except (OSError, json.JSONDecodeError) as error:
        transient = isinstance(error, json.JSONDecodeError) or error.errno in [errno.EPERM, errno.EACCES, errno.EBUSY]
        if previous is not None and transient:
            return previous
        raise


def active():
    return bool(os.environ.get('LH_HELPER_LEASE'))


def scope():
    if not active():
        return None
    key = (os.environ['LH_HELPER_LEASE'], os.environ.get('LH_HELPER_ID'))
    saved = _last_good.get(key, {})
    try:
        record = _read(lambda: _json(key[0]), saved.get('record'))
        current = _read(lambda: _json(record['registry']), saved.get('current'))
        names = _read(lambda: os.listdir(record['directory']), saved.get('names'))
        if (record['id'] != os.environ.get('LH_HELPER_ID') or record['expiresAt'] <= time.time() * 1000
                or any(record[key] != current[key] for key in
                       ['id', 'generation', 'sessionId', 'epoch', 'installationId'])):
            raise ValueError('retired')
        for name in names:
            if re.fullmatch(r'[0-9]+\.generation\.json', name) and int(name.split('.')[0]) > record['epoch']:
                raise ValueError('newer generation')
        _last_good[key] = dict(record=record, current=current, names=names)
        return dict(installationId=record['installationId'], sessionId=record['sessionId'],
                    epoch=record['epoch'], helperId=record['id'], board=record['board'])
    except (OSError, ValueError, KeyError, TypeError):
        _last_good.pop(key, None)
        raise SystemExit('WATCH LEASE | collector stopped: authority unconfirmed; re-arm')


def check():
    scope()


def headers():
    current = scope()
    return {'X-Lighthouse-Epoch': str(current['epoch'])} if current else {}
