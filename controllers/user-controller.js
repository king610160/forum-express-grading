const bcrypt = require('bcryptjs') // 載入 bcrypt
const { User, Comment, Restaurant, Category, Favorite, Like, Followship } = require('../models')
const { imgurFileHandler } = require('../helpers/file-helpers') // 將 file-helper 載進來
const { getUser } = require('../helpers/auth-helpers')

const userController = {
  signUpPage: (req, res) => {
    res.render('signup')
  },
  signUp: (req, res, next) => {
    // 如果兩次輸入的密碼不同，就建立一個 Error 物件並拋出
    if (req.body.password !== req.body.passwordCheck) throw new Error('Passwords do not match!')
    // 確認資料裡面沒有一樣的 email，若有，就建立一個 Error 物件並拋出
    User.findOne({ where: { email: req.body.email } })
      .then(user => {
        if (user) throw new Error('Email already exists!')
        return bcrypt.hash(req.body.password, 10) // 前面加 return
      })
      .then(hash => User.create({ // 上面錯誤狀況都沒發生，就把使用者的資料寫入資料庫
        name: req.body.name,
        email: req.body.email,
        password: hash
      }))
      .then(() => {
        req.flash('success_messages', '成功註冊帳號！') // 並顯示成功訊息
        res.redirect('/signin')
      })
      .catch(err => next(err)) // 接住前面拋出的錯誤，呼叫專門做錯誤處理的 middleware
  },
  signInPage: (req, res) => {
    res.render('signin')
  },
  signIn: (req, res) => {
    req.flash('success_messages', '成功登入！')
    res.redirect('/restaurants')
  },
  logout: (req, res) => {
    req.flash('success_messages', '登出成功！')
    req.logout()
    res.redirect('/signin')
  },
  getUser: (req, res) => {
    const loginId = getUser(req).id
    const id = Number(req.params.id)
    const where = {}
    where.userId = id
    return Promise.all([ // 非同步處理
      User.findByPk(req.params.id, {
        raw: true,
        nest: true
      }),
      Restaurant.findAll({
        include: [Category]
      }),
      Comment.count({
        where: {
          userId: Number(req.params.id)
        },
        attributes: ['restaurantId'],
        group: 'restaurantId',
        raw: true,
        nest: true
      }),
      Favorite.findAll({
        where: {
          userId: loginId
        },
        attributes: ['restaurantId'],
        group: 'restaurantId'
      }),
      Followship.findAll({
        where: {
          followerId: loginId
        },
        attributes: ['followingId']
      }),
      Followship.findAll({
        where: {
          followingId: loginId
        },
        attributes: ['followingId', 'followerId']
      }),
      User.findAll()
    ])
      .then(([user, restaurant, comment, favorite, following, follower, allUser]) => {
        const totalComment = req.user && comment.map(tc => tc.restaurantId) // 把所有comment的變成array
        const totalFavorite = req.user && favorite.map(tfa => tfa.restaurantId) // 把所有favorite的變成array
        const totalFollowing = req.user && following.map(tfo => tfo.followingId) // 把所有follower的變成array
        const totalFollower = req.user && follower.map(tfo => tfo.followerId) // 把所有following的變成array
        const commentCount = comment.length // 評論總數
        const favoriteCount = favorite.length // 收藏總數
        const followerCount = follower.length // 追隨者總數(被追)
        const followingCount = following.length // 追蹤者總數(主動)
        const restaurants = restaurant
          .map(r => ({
            ...r.toJSON(),
            isCommented: req.user && totalComment.includes(r.id), // 該user評論過的餐廳跟所有餐廳一個個比對
            isFavorited: req.user && totalFavorite.includes(r.id) // 該user評論過的餐廳跟所有餐廳一個個比對
          }))
        const users = allUser
          .map(u => ({
            ...u.toJSON(),
            isFollower: req.user && totalFollower.includes(u.id), // 該user追隨的所有user一個個比對
            isFollowing: req.user && totalFollowing.includes(u.id) // 該user被追隨的所有user一個個比對
          }))
        if (!user) throw new Error("User didn't exist!")
        return res.render('users/profile', {
          user,
          commentCount,
          loginId,
          restaurants,
          favoriteCount,
          users,
          followerCount,
          followingCount
        })
      })
  },
  editUser: (req, res) => {
    const loginId = getUser(req).id
    const id = Number(req.params.id)
    if (loginId !== id) {
      req.flash('error_messages', '禁止修改他人資料')
      return res.redirect('back')
    }
    return User.findByPk(id, {
      raw: true, // 讓拿到的資料是最簡單的javascript資料
      nest: true // 讓拿到的資料是比較簡單的. ex:restaurant.category.id
    })
      .then(user => {
        if (!user) throw new Error("User didn't exist!")
        res.render('users/edit', { user })
      })
  },
  putUser: (req, res, next) => {
    const loginId = req.user.id
    const { name } = req.body // 從 req.body 拿出表單裡的資料
    const id = Number(req.params.id)
    if (loginId !== id) {
      return req.flash('error_messages', '禁止修改他人資料')
    }
    if (!name) throw new Error('User name is required!') // name 是必填，若發先是空值就會終止程式碼，並在畫面顯示錯誤提示
    const { file } = req // 把檔案取出來，也可以寫成 const file = req.file
    return Promise.all([ // 非同步處理
      User.findByPk(id), // 去資料庫查有沒有這間餐廳
      imgurFileHandler(file) // 把檔案傳到 file-helper 處理
    ])
      .then(([users, filePath]) => {
        if (!users) throw new Error("Users didn't exist!")
        users.update({
          name,
          image: filePath || users.image // 如果 filePath 是 Truthy (使用者有上傳新照片) 就用 filePath，是 Falsy (使用者沒有上傳新照片) 就沿用原本資料庫內的值
        })
        req.flash('success_messages', '使用者資料編輯成功') // 在畫面顯示成功提示
        res.redirect(`/users/${id}`)
      })
      .catch(err => next(err))
  },
  addFavorite: (req, res, next) => {
    const { restaurantId } = req.params
    return Promise.all([
      Restaurant.findByPk(restaurantId),
      Favorite.findOne({
        where: {
          userId: req.user.id,
          restaurantId
        }
      })
    ])
      .then(([restaurant, favorite]) => {
        if (!restaurant) throw new Error("Restaurant didn't exist!")
        if (favorite) throw new Error('You have favorited this restaurant!')

        return Favorite.create({
          userId: req.user.id,
          restaurantId
        })
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },
  removeFavorite: (req, res, next) => {
    return Favorite.findOne({
      where: {
        userId: req.user.id,
        restaurantId: req.params.restaurantId
      }
    })
      .then(favorite => {
        if (!favorite) throw new Error("You haven't favorited this restaurant")

        return favorite.destroy()
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },
  addLike: (req, res, next) => {
    const { restaurantId } = req.params
    return Promise.all([
      Restaurant.findByPk(restaurantId),
      Like.findOne({
        where: {
          userId: req.user.id,
          restaurantId
        }
      })
    ])
      .then(([restaurant, like]) => {
        if (!restaurant) throw new Error("Restaurant didn't exist!")
        if (like) throw new Error('You have liked this restaurant!')

        return Like.create({
          userId: req.user.id,
          restaurantId
        })
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },
  removeLike: (req, res, next) => {
    return Like.findOne({
      where: {
        userId: req.user.id,
        restaurantId: req.params.restaurantId
      }
    })
      .then(like => {
        if (!like) throw new Error("You haven't liked this restaurant")

        return like.destroy()
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },
  getTopUsers: (req, res, next) => {
    const userId = req.user.id
    // 撈出所有 User 與 followers 資料
    return User.findAll({
      include: [{ model: User, as: 'Followers' }]
    })
      .then(users => {
        // 整理 users 資料，把每個 user 項目都拿出來處理一次，並把新陣列儲存在 users 裡
        const result = users
          .map(user => ({
            // 整理格式
            ...user.toJSON(),
            // 計算追蹤者人數
            followerCount: user.Followers.length,
            // 判斷目前登入使用者是否已追蹤該 user 物件
            isFollowed: req.user.Followings.some(f => f.id === user.id),
            isSelf: userId === user.id
          }))
          .sort((a, b) => b.followerCount - a.followerCount)
        console.log(result)
        res.render('top-users', { users: result })
      })
      .catch(err => next(err))
  },
  addFollowing: (req, res, next) => {
    const { userId } = req.params
    if (Number(req.params.userId) === req.user.id) throw new Error('不能收藏自己!')
    Promise.all([
      User.findByPk(userId),
      Followship.findOne({
        where: {
          followerId: req.user.id,
          followingId: req.params.userId
        }
      })
    ])
      .then(([user, followship]) => {
        if (!user) throw new Error("User didn't exist!")
        if (followship) throw new Error('You are already following this user!')
        return Followship.create({
          followerId: req.user.id,
          followingId: userId
        })
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },
  removeFollowing: (req, res, next) => {
    Followship.findOne({
      where: {
        followerId: req.user.id,
        followingId: req.params.userId
      }
    })
      .then(followship => {
        if (!followship) throw new Error("You haven't followed this user!")
        return followship.destroy()
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  }
}
module.exports = userController
