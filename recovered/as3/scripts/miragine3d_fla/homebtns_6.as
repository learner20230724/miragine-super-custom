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
   
   [Embed(source="/_assets/assets.swf", symbol="symbol55")]
   public dynamic class homebtns_6 extends MovieClip
   {
      
      public var bn_creadit:SimpleButton;
      
      public var bn_mp:SimpleButton;
      
      public var bn_easy:SimpleButton;
      
      public var bn_back:SimpleButton;
      
      public var bn_hard:SimpleButton;
      
      public var bn_sp:SimpleButton;
      
      public var bn_normal:SimpleButton;
      
      public var bn_abyss:SimpleButton;
      
      public function homebtns_6()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      public function onClick(param1:*) : *
      {
         switch(param1.currentTarget)
         {
            case this.bn_sp:
               Object(root).singlePlay = true;
               TweenMax.to(this,0.5,{"x":-43});
               break;
            case this.bn_back:
               TweenMax.to(this,0.5,{"x":212});
               break;
            case this.bn_mp:
               Object(root).singlePlay = false;
               Object(root).gotoAndStop("game");
               break;
            case this.bn_easy:
               Object(root).difficulty = 0;
               Object(root).gotoAndStop("game");
               break;
            case this.bn_normal:
               Object(root).difficulty = 1;
               Object(root).gotoAndStop("game");
               break;
            case this.bn_hard:
               Object(root).difficulty = 2;
               Object(root).gotoAndStop("game");
               break;
            case this.bn_abyss:
               Object(root).difficulty = 3;
               Object(root).gotoAndStop("game");
               break;
            case this.bn_creadit:
               Object(parent).credit.visible = true;
         }
      }
      
      internal function frame1() : *
      {
         this.bn_sp.addEventListener("click",this.onClick);
         this.bn_mp.addEventListener("click",this.onClick);
         this.bn_easy.addEventListener("click",this.onClick);
         this.bn_normal.addEventListener("click",this.onClick);
         this.bn_hard.addEventListener("click",this.onClick);
         this.bn_abyss.addEventListener("click",this.onClick);
         this.bn_back.addEventListener("click",this.onClick);
         this.bn_creadit.addEventListener("click",this.onClick);
      }
   }
}

