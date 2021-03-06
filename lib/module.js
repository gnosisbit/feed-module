const path = require('path')
const fs = require('fs-extra')
const AsyncCache = require('async-cache')
const pify = require('pify')
const Feed = require('feed')
const consola = require('consola')

const logger = consola.withScope('nuxt:feed')

const defaults = {
  path: '/feed.xml',
  async create (feed) {},
  cacheTime: 1000 * 60 * 15
}

module.exports = async function feed () {
  if (typeof this.options.feed === 'function') {
    this.options.feed = await this.options.feed()
  }

  if (!Array.isArray(this.options.feed)) {
    this.options.feed = [this.options.feed]
  }

  const options = Object.assign([], this.options.feed).map(o => Object.assign({}, defaults, o))

  const feedCache = new AsyncCache({
    maxAge: options.cacheTime,
    load (feedIndex, callback) {
      createFeed(options[feedIndex], callback)
    }
  })

  feedCache.get = pify(feedCache.get)

  await options.forEach(async (feedOptions, index) => {
    this.nuxt.hook('generate:before', async () => {
      const xmlGeneratePath = path.resolve(this.options.srcDir, path.join('static', feedOptions.path))
      await fs.removeSync(xmlGeneratePath)
      await fs.outputFile(xmlGeneratePath, await feedCache.get(index))
    })

    this.addServerMiddleware({
      path: feedOptions.path,
      handler (req, res, next) {
        feedCache.get(index)
          .then(xml => {
            res.setHeader('Content-Type', resolveContentType(feedOptions.type))
            res.end(xml)
          })
          .catch(/* istanbul ignore next: Nuxt handling */ err => { next(err) })
      }
    })
  })
}

function resolveContentType (type) {
  const lookup = {
    rss2: 'application/rss+xml',
    atom1: 'application/atom+xml',
    json1: 'application/json'
  }
  return lookup.hasOwnProperty(type) ? lookup[type] : 'application/xml'
}

async function createFeed (feedOptions, callback) {
  if (!['rss2', 'json1', 'atom1'].includes(feedOptions.type)) {
    logger.fatal(`Could not create Feed ${feedOptions.path} - Unknown feed type`)
    return callback(null, '', feedOptions.cacheTime)
  }

  const feed = new Feed()
  await feedOptions.create.call(this, feed)
  return callback(null, feed[feedOptions.type](), feedOptions.cacheTime)
}

module.exports.meta = require('../package.json')
