package miragine3d_fla
{
   import adobe.utils.*;
   import com.greensock.*;
   import com.greensock.easing.*;
   import flash.accessibility.*;
   import flash.desktop.*;
   import flash.display.*;
   import flash.errors.*;
   import flash.events.*;
   import flash.external.*;
   import flash.filters.*;
   import flash.geom.*;
   import flash.globalization.*;
   import flash.media.*;
   import flash.net.*;
   import flash.net.drm.*;
   import flash.printing.*;
   import flash.profiler.*;
   import flash.sampler.*;
   import flash.sensors.*;
   import flash.system.*;
   import flash.text.*;
   import flash.text.engine.*;
   import flash.text.ime.*;
   import flash.ui.*;
   import flash.utils.*;
   import flash.xml.*;
   
   [SWF(width="640", height="480", backgroundColor="#0e0e0e", frameRate="30")]
   public dynamic class MainTimeline extends MovieClip
   {
      
      public var unit_title:MovieClip;
      
      public var unit_over:MovieClip;
      
      public var tutorial:MovieClip;
      
      public var tt:TextField;
      
      public var gameover:SimpleButton;
      
      public var tipopen:SimpleButton;
      
      public var bnquit:SimpleButton;
      
      public var unit_ui:MovieClip;
      
      public var quitgame:MovieClip;
      
      public var singlePlay:Boolean;
      
      public var difficulty:int;
      
      public var winner:String;
      
      public var soundChannel:SoundChannel;
      
      public var game:*;
      
      public var so:SharedObject;
      
      public function MainTimeline()
      {
         super();
         addFrameScript(0,this.frame1,9,this.frame10,10,this.frame11,19,this.frame20,30,this.frame31);
      }
      
      public function soundFade() : *
      {
         if(this.soundChannel)
         {
            this.soundChannel.stop();
         }
         this.soundChannel = new gameLoop().play(0,9999);
         TweenMax.from(this.soundChannel,2,{"volume":0});
      }
      
      public function onWin(param1:*) : *
      {
         this.winner = param1.data;
         this.gameover.visible = true;
         this.gameover.alpha = 0;
         TweenMax.to(this.gameover,0.6,{
            "alpha":1,
            "y":200,
            "delay":0.3,
            "onComplete":this.delaygoover
         });
      }
      
      public function goover() : *
      {
         removeChild(this.game);
         Object(root).gotoAndStop("over");
      }
      
      public function delaygoover() : *
      {
         setTimeout(this.goover,2000);
      }
      
      public function onClick(param1:*) : *
      {
         if(param1.currentTarget == this.gameover)
         {
            removeChild(this.game);
            Object(root).gotoAndStop("over");
         }
         else if(param1.currentTarget == this.tipopen)
         {
            this.tutorial.visible = true;
         }
         else if(param1.currentTarget == this.bnquit)
         {
            this.quitgame.visible = true;
         }
      }
      
      public function onKey(param1:*) : *
      {
         if(param1.keyCode == 27)
         {
            this.quitgame.visible = true;
         }
      }
      
      public function soundFade2() : *
      {
         if(this.soundChannel)
         {
            this.soundChannel.stop();
         }
         if(this.winner == "left")
         {
            this.soundChannel = new sd_win().play(0,1);
         }
         else
         {
            this.soundChannel = new sd_lose().play(0,1);
         }
         TweenMax.from(this.soundChannel,1,{"volume":0});
      }
      
      internal function frame1() : *
      {
         gotoAndPlay("init");
         root.scrollRect = new Rectangle(0,0,640,480);
      }
      
      internal function frame10() : *
      {
         new WowTips(this);
         this.game = new DragonForce();
      }
      
      internal function frame11() : *
      {
         stop();
         TweenMax.from(root,0.8,{
            "tint":921102,
            "ease":Sine.easeInOut
         });
         if(this.soundChannel)
         {
            this.soundChannel.stop();
         }
         this.soundChannel = new mainLoop().play(0,9999);
         TweenMax.from(this.soundChannel,0,{"volume":0});
         this.unit_title.bn_btns.visible = true;
         this.unit_title.bn_loading.visible = false;
      }
      
      internal function frame20() : *
      {
         TweenMax.from(root,0.8,{
            "tint":921102,
            "ease":Sine.easeInOut
         });
         trace(this.game);
         this.game.singlePlay = this.singlePlay;
         this.game.difficulty = this.difficulty;
         this.game.initUI(this.unit_ui);
         this.so = SharedObject.getLocal("miraginewar");
         if(this.so.data.never == true)
         {
            this.tutorial.visible = false;
         }
         else
         {
            this.game.stopTimer = true;
         }
         if(this.singlePlay)
         {
            this.tt.visible = true;
            if(this.difficulty == 0)
            {
               this.tt.text = "简单的难度";
            }
            else if(this.difficulty == 1)
            {
               this.tt.text = "普通的难度";
            }
            else if(this.difficulty == 2)
            {
               this.tt.text = "困难的难度";
            }
            else
            {
               this.tt.text = "不可战胜的难度";
            }
         }
         this.game.addEventListener("win",this.onWin);
         addChildAt(this.game,0);
         stage.focus = stage;
         TweenMax.to(this.soundChannel,2,{
            "volume":0,
            "onComplete":this.soundFade
         });
         this.gameover.visible = false;
         this.tipopen.addEventListener("click",this.onClick);
         this.bnquit.addEventListener("click",this.onClick);
         this.quitgame.visible = false;
         stage.addEventListener(KeyboardEvent.KEY_DOWN,this.onKey);
      }
      
      internal function frame31() : *
      {
         TweenMax.from(root,0.8,{
            "tint":921102,
            "ease":Sine.easeInOut
         });
         trace("winner",this.winner);
         if(this.winner == "left")
         {
            this.unit_over.win.x = 159;
            this.unit_over.lose.x = 484;
         }
         else
         {
            this.unit_over.win.x = 484;
            this.unit_over.lose.x = 159;
         }
         this.soundFade2();
      }
   }
}

