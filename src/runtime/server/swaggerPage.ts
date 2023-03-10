import { defineEventHandler } from 'h3'
import { config } from '#oa'

export default defineEventHandler(event => `<html>
  <head>
    <title>Swagger doc</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
      *, *:before, *:after { box-sizing: inherit; }
      body { margin: 0; padding: 0; }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.css" integrity="sha512-3ZF6q2IwJ/o3zbm5kBJX1RtjPFxnFcTBH+pa/jtnvvhygsYFcEqX+T9guR01rI8gozi4fPU95W+SZES6ew28qA==" crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.js" integrity="sha512-bqxUYoYPf4DzvJH9o51SnEYzjylQLBD4Zua6CFq/uB71a7yxjEC7YPxHPreZqJEmbrR2litKgWGf6BIkhTna2A==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-standalone-preset.js" integrity="sha512-mSlCZQwAsAAtUmh/QvJmywaDd0m+QK/VfEj1QtP6rmr5hJ/PgV7iEOpA96vf5jX/1i41YuEGdJ3KNVdiFHmanA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          url: "${config.openApiPath}",
          dom_id: '#swagger-ui',
          requestInterceptor (req) {
            if (req.url === '${config.openApiPath}') {
              req.headers['Content-Type'] = 'application/json'
            }
            return req
          }
        })
      }
    </script>
  </body>
</html>`)
