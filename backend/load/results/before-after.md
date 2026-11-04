# Baseline A (BEFORE global write mutex) — observed 2026-11-04
#
# Same script (mixed-workload.js @ stages 20/100/200 VUs) against the same
# seed, but with per-auction write serialization only (bid mutex keyed per
# auction, letting different auction transactions contend on SQLite's single
# writer). Under 200 VUs this produced SQLITE_BUSY storms (Sequelize opens a
# fresh connection per transaction); 53 bid requests fell outside the
# accepted/rejected envelope (5xx).

http_reqs......................: 11353  62.85/s
http_req_duration..............: avg=1.47s  med=9.51ms   max=26.69s  p(90)=5.04s  p(95)=6.07s
http_req_failed................: 4.21%  479/11353
server log: 29577 lines, SQLITE_BUSY storms + transaction rollback/kill failures

# Baseline B (AFTER global write mutex) — same machine, same script
# (see mixed-run3.txt for the raw k6 output)

http_reqs......................: 71894  398.85/s
http_req_duration..............: avg=51.6ms med=40.05ms  max=555ms  p(90)=124ms  p(95)=166ms
server_errors_5xx..............: 0
http_req_failed................: 5.05%  (exclusively expected business rejections:
                                        409 BID_TOO_LOW races + 403 own-auction bids)