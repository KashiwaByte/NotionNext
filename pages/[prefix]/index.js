import BLOG from '@/blog.config'
import { getPostBlocks } from '@/lib/notion'
import { getGlobalData } from '@/lib/notion/getNotionData'
import { useEffect, useState } from 'react'
import { idToUuid } from 'notion-utils'
import { useRouter } from 'next/router'
import { getNotion } from '@/lib/notion/getNotion'
import { getPageTableOfContents } from '@/lib/notion/getPageTableOfContents'
import { getLayoutByTheme } from '@/themes/theme'
import md5 from 'js-md5'
import { isBrowser } from '@/lib/utils'
import { uploadDataToAlgolia } from '@/lib/algolia'

/**
 * 根据notion的slug访问页面
 * @param {*} props
 * @returns
 */
const Slug = props => {
  const { post, siteInfo } = props
  const router = useRouter()

  // 文章锁🔐
  const [lock, setLock] = useState(post?.password && post?.password !== '')

  /**
   * 验证文章密码
   * @param {*} result
  */
  const validPassword = passInput => {
    const encrypt = md5(post.slug + passInput)
    if (passInput && encrypt === post.password) {
      setLock(false)
      return true
    }
    return false
  }

  // 文章加载
  useEffect(() => {
    // 404
    if (!post) {
      setTimeout(() => {
        if (isBrowser()) {
          const article = document.getElementById('notion-article')
          if (!article) {
            router.push('/404').then(() => {
              console.warn('找不到页面', router.asPath)
            })
          }
        }
      }, 8 * 1000) // 404时长 8秒
    }

    // 文章加密
    if (post?.password && post?.password !== '') {
      setLock(true)
    } else {
      setLock(false)
      if (!lock && post?.blockMap?.block) {
        post.content = Object.keys(post.blockMap.block).filter(key => post.blockMap.block[key]?.value?.parent_id === post.id)
        post.toc = getPageTableOfContents(post, post.blockMap)
      }
    }
  }, [post])

  const meta = {
    title: post ? `${post?.title} | ${siteInfo?.title}` : `${props?.siteInfo?.title || BLOG.TITLE} | loading`,
    description: post?.summary,
    type: post?.type,
    slug: post?.slug,
    image: post?.pageCoverThumbnail || (siteInfo?.pageCover || BLOG.HOME_BANNER_IMAGE),
    category: post?.category?.[0],
    tags: post?.tags
  }
  props = { ...props, lock, meta, setLock, validPassword }
  // 根据页面路径加载不同Layout文件
  const Layout = getLayoutByTheme(useRouter())
  return <Layout {...props} />
}

export async function getStaticPaths() {
  if (!BLOG.isProd) {
    return {
      paths: [],
      fallback: true
    }
  }

  const from = 'slug-paths'
  const { allPages } = await getGlobalData({ from })
  return {
    paths: allPages?.filter(row => row.slug.indexOf('/') < 0).map(row => ({ params: { prefix: row.slug } })),
    fallback: true
  }
}

export async function getStaticProps({ params: { prefix } }) {
  let fullSlug = prefix
  if (JSON.parse(BLOG.PSEUDO_STATIC)) {
    if (!fullSlug.endsWith('.html')) {
      fullSlug += '.html'
    }
  }
  const from = `slug-props-${fullSlug}`
  const props = await getGlobalData({ from })
  // 在列表内查找文章
  props.post = props?.allPages?.find((p) => {
    return p.slug === fullSlug || p.id === idToUuid(fullSlug)
  })

  // 处理非列表内文章的内信息
  if (!props?.post) {
    const pageId = prefix
    if (pageId.length >= 32) {
      const post = await getNotion(pageId)
      props.post = post
    }
  }
  // 无法获取文章
  if (!props?.post) {
    props.post = null
    return { props, revalidate: parseInt(BLOG.NEXT_REVALIDATE_SECOND) }
  }

  // 文章内容加载
  if (!props?.posts?.blockMap) {
    props.post.blockMap = await getPostBlocks(props.post.id, from)
  }

  if (BLOG.ALGOLIA_APP_ID && BLOG.ALGOLIA_APP_KEY) {
    uploadDataToAlgolia(props?.post)
  }

  // 推荐关联文章处理
  const allPosts = props.allPages.filter(page => page.type === 'Post' && page.status === 'Published')
  if (allPosts && allPosts.length > 0) {
    const index = allPosts.indexOf(props.post)
    props.prev = allPosts.slice(index - 1, index)[0] ?? allPosts.slice(-1)[0]
    props.next = allPosts.slice(index + 1, index + 2)[0] ?? allPosts[0]
    props.recommendPosts = getRecommendPost(props.post, allPosts, BLOG.POST_RECOMMEND_COUNT)
  } else {
    props.prev = null
    props.next = null
    props.recommendPosts = []
  }

  delete props.allPages
  return {
    props,
    revalidate: parseInt(BLOG.NEXT_REVALIDATE_SECOND)
  }
}

/**
 * 获取文章的关联推荐文章列表，目前根据标签关联性筛选
 * @param post
 * @param {*} allPosts
 * @param {*} count
 * @returns
 */
export function getRecommendPost(post, allPosts, count = 6) {
  let recommendPosts = []
  const postIds = []
  const currentTags = post?.tags || []
  for (let i = 0; i < allPosts.length; i++) {
    const p = allPosts[i]
    if (p.id === post.id || p.type.indexOf('Post') < 0) {
      continue
    }

    for (let j = 0; j < currentTags.length; j++) {
      const t = currentTags[j]
      if (postIds.indexOf(p.id) > -1) {
        continue
      }
      if (p.tags && p.tags.indexOf(t) > -1) {
        recommendPosts.push(p)
        postIds.push(p.id)
      }
    }
  }

  if (recommendPosts.length > count) {
    recommendPosts = recommendPosts.slice(0, count)
  }
  return recommendPosts
}

export default Slug
