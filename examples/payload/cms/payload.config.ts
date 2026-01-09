import { definePayload, collection } from '@dotdo/payload'

const Users = collection({ slug: 'users', auth: true, fields: [] })

const Authors = collection({
  slug: 'authors',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'bio', type: 'textarea' },
  ],
})

const Blogs = collection({
  slug: 'blogs',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
  ],
})

const Posts = collection({
  slug: 'posts',
  admin: { useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'content', type: 'richText' },
    { name: 'blog', type: 'relationship', relationTo: 'blogs', required: true },
    { name: 'author', type: 'relationship', relationTo: 'authors' },
    { name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true },
    { name: 'publishedAt', type: 'date' },
  ],
})

const Tags = collection({
  slug: 'tags',
  admin: { useAsTitle: 'name' },
  fields: [{ name: 'name', type: 'text', required: true, unique: true }],
})

export default definePayload({
  collections: [Users, Authors, Blogs, Posts, Tags],
})
